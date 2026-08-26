import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_STATION_LIMIT,
  DEFAULT_STATION_RADIUS_METERS,
  MAX_STATION_LIMIT,
  MAX_STATION_RADIUS_METERS,
  type GeoPoint,
  type NearbyStationsResult,
  type SharedMobilityUnavailableReason,
} from '@urbanflow/shared';

import { GbfsClient, GbfsUnavailableError } from './gbfs/gbfs.client';
import { toNearbyStations } from './gbfs/gbfs.mapper';

/** Options de recherche, hors point de référence. */
export interface NearbyStationsOptions {
  /** Rayon de recherche en mètres (défaut : 500, plafond : 2000). */
  radiusMeters?: number;
  /** Nombre maximal de stations rendues (défaut : 10, plafond : 50). */
  limit?: number;
}

/**
 * Rayon minimal accepté.
 *
 * En dessous de 50 m, la précision d'un GPS de smartphone en ville (souvent
 * 20 à 60 m — C6) rendrait le résultat aléatoire : la station d'en face
 * apparaîtrait ou disparaîtrait au gré du bruit de mesure.
 */
const MIN_STATION_RADIUS_METERS = 50;

/**
 * Connecteur mobilités douces (UF-303) — volet GBFS de F3.
 *
 * Interroge les flux GBFS d'un opérateur de vélos et trottinettes en
 * libre-service (Vélo'v à Lyon) et rend des stations au format interne
 * `SharedMobilityStation`, indépendant de la structure de GBFS. Avec
 * `TransitService` (UF-302), c'est la seconde source que le Service Itinéraire
 * fusionnera en itinéraires multimodaux (UF-305).
 *
 * **Contrat de résilience** : la méthode ne lève jamais d'exception à cause de
 * l'opérateur. Un timeout, un flux retiré ou une réponse invalide donnent un
 * résultat `status: 'unavailable'` que le Service Itinéraire traite comme
 * « ce mode n'est pas proposé cette fois », sans perdre les autres options
 * (dégradation gracieuse — C10, recette 3 du ticket). Seule une entrée invalide
 * (coordonnées absurdes) lève une erreur : c'est un défaut d'appel, pas une panne.
 *
 * **Fraîcheur** (recette 2) : les trois flux ne sont pas mémoïsés de la même
 * façon, parce qu'ils ne vieillissent pas à la même vitesse. La description des
 * stations et le catalogue des véhicules tiennent une heure ; la disponibilité
 * est relue toutes les `GBFS_STATUS_TTL_MS` (une minute par défaut). La réponse
 * porte `publishedAt`, l'horodatage de l'opérateur lui-même — le client peut
 * ainsi juger de la fraîcheur sans nous croire sur parole.
 *
 * Couvre : F3, C5 (mémoïsation graduée, appels parallèles, bornage du volume),
 * C6 (rayon plancher aligné sur la précision GPS réelle), C9 (GBFS standard,
 * contrats partagés), C10 (timeouts bornés, dégradation gracieuse), C11 (aucune
 * position journalisée).
 */
@Injectable()
export class SharedMobilityService {
  private readonly logger = new Logger(SharedMobilityService.name);

  constructor(private readonly gbfs: GbfsClient) {}

  /**
   * Stations de véhicules en libre-service autour d'un point.
   *
   * @param point Point de référence — position de l'usager (C6) ou extrémité d'un trajet
   * @param options Rayon de recherche et nombre maximal de stations
   * @returns Stations du rayon triées par distance, ou un résultat `unavailable`
   *   si l'opérateur n'a pas répondu
   * @throws {BadRequestException} si le point n'est pas une position valide sur Terre
   */
  async getNearbyStations(
    point: GeoPoint,
    options: NearbyStationsOptions = {},
  ): Promise<NearbyStationsResult> {
    assertValidPoint(point);

    const radiusMeters = clampRadius(options.radiusMeters);
    const limit = clampLimit(options.limit);

    try {
      // Trois flux indépendants : les lire en parallèle plutôt qu'en cascade
      // évite d'additionner trois latences réseau sur la requête de l'usager
      // (C10). En régime établi, deux des trois sont servis par le cache.
      const [information, status, vehicleTypes] = await Promise.all([
        this.gbfs.getStationInformation(),
        this.gbfs.getStationStatus(),
        this.gbfs.getVehicleTypes(),
      ]);

      const stations = toNearbyStations({
        information,
        status: status.stations,
        vehicleTypes,
        origin: { lat: point.lat, lng: point.lng },
        radiusMeters,
        limit,
      });

      // Compter, pas localiser : le nombre de stations suffit au diagnostic,
      // alors qu'un point de départ journalisé serait une donnée de
      // déplacement (C11).
      this.logger.log(`GBFS : ${stations.length} station(s) dans un rayon de ${radiusMeters} m.`);

      return { status: 'ok', stations, radiusMeters, publishedAt: status.publishedAt };
    } catch (error) {
      return this.toUnavailableResult(error, radiusMeters);
    }
  }

  /**
   * Vérifie que l'opérateur publie un statut exploitable, pour l'état des
   * sources (C10).
   *
   * @returns Fraîcheur et volume du flux, ou la cause de son indisponibilité
   */
  probe(): ReturnType<GbfsClient['probe']> {
    return this.gbfs.probe();
  }

  /** Traduit une panne de l'opérateur en résultat exploitable, sans propager l'exception. */
  private toUnavailableResult(error: unknown, radiusMeters: number): NearbyStationsResult {
    // Une cause inattendue (bug de mapping, mémoire) est traitée comme une
    // indisponibilité amont : le planificateur doit rester debout quoi qu'il
    // arrive à cette source (C10). L'erreur reste tracée pour le diagnostic.
    const reason: SharedMobilityUnavailableReason =
      error instanceof GbfsUnavailableError ? error.reason : 'upstream-error';

    if (error instanceof GbfsUnavailableError) {
      this.logger.warn(`Stations en libre-service indisponibles (${reason}) : ${error.message}`);
    } else {
      this.logger.error(
        `Échec inattendu du connecteur mobilités douces : ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      status: 'unavailable',
      stations: [],
      unavailableReason: reason,
      radiusMeters,
      publishedAt: null,
    };
  }
}

/**
 * Refuse un point dont les coordonnées ne désignent pas un lieu de la Terre.
 *
 * Deuxième ligne de défense : le DTO valide déjà les entrées HTTP (C4), mais un
 * appel interne fautif produirait sinon une liste vide impossible à
 * diagnostiquer — « aucune station » et « coordonnées absurdes » se ressemblent
 * beaucoup dans une réponse JSON.
 */
function assertValidPoint(point: GeoPoint): void {
  const { lat, lng } = point;
  const valid =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  if (!valid) {
    throw new BadRequestException('Coordonnées invalides pour la recherche de stations.');
  }
}

/** Borne le rayon demandé entre le plancher GPS et le plafond de rabattement. */
function clampRadius(radiusMeters: number | undefined): number {
  if (radiusMeters === undefined || !Number.isFinite(radiusMeters)) {
    return DEFAULT_STATION_RADIUS_METERS;
  }
  return Math.min(
    Math.max(Math.round(radiusMeters), MIN_STATION_RADIUS_METERS),
    MAX_STATION_RADIUS_METERS,
  );
}

/** Borne le nombre de stations rendues. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit)) return DEFAULT_STATION_LIMIT;
  return Math.min(Math.max(limit, 1), MAX_STATION_LIMIT);
}
