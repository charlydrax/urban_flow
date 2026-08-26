import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  TransitEndpoint,
  TransitJourney,
  TransitJourneysResult,
  TransitQuery,
} from '@urbanflow/shared';

import { OtpClient, OtpUnavailableError } from './otp/otp.client';
import { toTransitJourneys } from './otp/otp.mapper';
import type { OtpPlanData } from './otp/otp.types';
import { alignToServiceWindow, toNetworkDateTime } from './otp/service-date';

/** Options de recherche, hors extrémités du trajet. */
export type TransitSearchOptions = Omit<TransitQuery, 'from' | 'to'>;

/** Nombre de trajets demandés par défaut au moteur. */
const DEFAULT_MAX_RESULTS = 3;

/** Borne haute du nombre de trajets : au-delà, on paie du calcul pour rien (C5). */
const MAX_RESULTS_LIMIT = 6;

/**
 * Requête d'itinéraire adressée à OpenTripPlanner.
 *
 * Les modes sont figés à `TRANSIT` + `WALK` : ce connecteur ne traite que les
 * transports en commun et leur rabattement à pied. Les mobilités douces
 * (vélos, trottinettes) viennent d'un flux GBFS distinct (UF-303), et c'est le
 * Service Itinéraire qui fusionnera les deux (UF-305).
 *
 * Le jeu de champs est volontairement restreint à ce que le format interne
 * consomme réellement : chaque champ demandé est du calcul côté OTP et des
 * octets sur le réseau (C5).
 */
const PLAN_QUERY = `
query Plan(
  $from: InputCoordinates!
  $to: InputCoordinates!
  $date: String!
  $time: String!
  $numItineraries: Int!
  $wheelchair: Boolean!
) {
  plan(
    from: $from
    to: $to
    date: $date
    time: $time
    numItineraries: $numItineraries
    wheelchair: $wheelchair
    transportModes: [{ mode: TRANSIT }, { mode: WALK }]
  ) {
    itineraries {
      duration
      startTime
      endTime
      walkDistance
      legs {
        mode
        startTime
        endTime
        duration
        distance
        transitLeg
        headsign
        legGeometry { points }
        route { shortName longName agency { name } }
        trip { tripHeadsign wheelchairAccessible }
        from { name lat lon stop { gtfsId name wheelchairBoarding } }
        to { name lat lon stop { gtfsId name wheelchairBoarding } }
      }
    }
  }
}`;

/**
 * Connecteur transports en commun (UF-302) — volet GTFS de F3.
 *
 * Interroge l'instance OpenTripPlanner auto-hébergée (UF-301) et rend des
 * trajets au format interne `TransitJourney`, indépendant de la structure d'OTP.
 * C'est la seule classe de l'application qui sait qu'un moteur de routage existe.
 *
 * **Contrat de résilience** : la méthode ne lève jamais d'exception à cause du
 * moteur. Un timeout, un service arrêté ou une réponse invalide donnent un
 * résultat `status: 'unavailable'` que le Service Itinéraire traite comme
 * « ce mode n'est pas proposé cette fois », sans perdre les autres options
 * (dégradation gracieuse — C10). Seule une entrée invalide (coordonnées
 * absurdes) lève une erreur : c'est un défaut d'appel, pas une panne.
 *
 * Couvre : F3, C9 (GTFS via l'API standard d'OTP, sortie GeoJSON), C10
 * (timeouts bornés, dégradation gracieuse), C11 (logs sans donnée de
 * déplacement), C12 (accessibilité PMR propagée).
 */
@Injectable()
export class TransitService {
  private readonly logger = new Logger(TransitService.name);

  constructor(private readonly otp: OtpClient) {}

  /**
   * Recherche des trajets en transports en commun entre deux points.
   *
   * @param from Point de départ (coordonnées obligatoires — le géocodage est fait en amont, UF-203)
   * @param to Point d'arrivée
   * @param options Instant de départ, accessibilité PMR, nombre de résultats
   * @returns Trajets normalisés, ou un résultat `unavailable` si le moteur n'a pas répondu
   * @throws {BadRequestException} si une coordonnée n'est pas un point valide sur Terre
   */
  async getTransitJourneys(
    from: TransitEndpoint,
    to: TransitEndpoint,
    options: TransitSearchOptions = {},
  ): Promise<TransitJourneysResult> {
    assertValidEndpoint(from, 'from');
    assertValidEndpoint(to, 'to');

    const departure = parseDeparture(options.departureAt);
    const { date: requestedDate, time } = toNetworkDateTime(departure);

    // Suivis hors du `try` : en cas de panne, le résultat doit rapporter la date
    // réellement visée, pas retomber sur la date demandée.
    let serviceDate = requestedDate;
    let dateAdjusted = false;

    try {
      // La période couverte est mémoïsée par le client : en régime établi, cette
      // ligne ne coûte aucun aller-retour réseau.
      const window = await this.otp.getServiceWindow();
      const aligned = alignToServiceWindow(requestedDate, window);
      serviceDate = aligned.serviceDate;
      dateAdjusted = aligned.adjusted;

      if (dateAdjusted) {
        this.logger.warn(
          `Date ${requestedDate} hors de la période couverte par le GTFS chargé : ` +
            `interrogation reportée au ${serviceDate} (même jour de semaine). ` +
            'Voir docs/otp-gtfs.md — mise à jour du flux GTFS.',
        );
      }

      const data = await this.otp.query<OtpPlanData>(
        PLAN_QUERY,
        {
          from: { lat: from.lat, lon: from.lng },
          to: { lat: to.lat, lon: to.lng },
          date: serviceDate,
          time,
          numItineraries: clampMaxResults(options.maxResults),
          wheelchair: options.wheelchair === true,
        },
        'plan',
      );

      const journeys: TransitJourney[] = toTransitJourneys(data.plan?.itineraries);
      // Compter, pas détailler : le nombre de trajets suffit au diagnostic, alors
      // qu'un itinéraire journalisé serait une donnée de déplacement (C11).
      this.logger.log(`OTP plan : ${journeys.length} trajet(s) TC pour le ${serviceDate}.`);

      return { status: 'ok', journeys, requestedDate, serviceDate, dateAdjusted };
    } catch (error) {
      return this.toUnavailableResult(error, requestedDate, serviceDate, dateAdjusted);
    }
  }

  /**
   * Vérifie que le moteur de routage répond, pour l'état des sources (C10).
   *
   * Le cache est volontairement contourné : une sonde de santé qui lit une
   * valeur mémoïsée une heure annoncerait un moteur « opérationnel » une heure
   * après son arrêt. C'est le seul appel du connecteur dans ce cas, et il n'a
   * lieu que sur demande explicite de diagnostic.
   *
   * @returns La période couverte par le graphe si le moteur répond, `null` sinon
   */
  async probe(): Promise<{
    reachable: boolean;
    serviceWindow: { from: string; to: string } | null;
  }> {
    try {
      const window = await this.otp.getServiceWindow(true);
      if (!window) return { reachable: true, serviceWindow: null };

      return {
        reachable: true,
        serviceWindow: {
          from: new Date(window.start * 1000).toISOString(),
          to: new Date(window.end * 1000).toISOString(),
        },
      };
    } catch {
      return { reachable: false, serviceWindow: null };
    }
  }

  /** Traduit une panne du moteur en résultat exploitable, sans jamais propager l'exception. */
  private toUnavailableResult(
    error: unknown,
    requestedDate: string,
    serviceDate: string,
    dateAdjusted: boolean,
  ): TransitJourneysResult {
    // Une cause inattendue (bug de mapping, mémoire) est traitée comme une
    // indisponibilité amont : le planificateur doit rester debout quoi qu'il
    // arrive à cette source (C10). L'erreur reste tracée pour le diagnostic.
    const reason = error instanceof OtpUnavailableError ? error.reason : 'upstream-error';
    if (!(error instanceof OtpUnavailableError)) {
      this.logger.error(
        `Échec inattendu du connecteur TC : ${error instanceof Error ? error.message : String(error)}`,
      );
    } else {
      this.logger.warn(`Trajets TC indisponibles (${reason}) : ${error.message}`);
    }

    return {
      status: 'unavailable',
      journeys: [],
      unavailableReason: reason,
      requestedDate,
      serviceDate,
      dateAdjusted,
    };
  }
}

/**
 * Refuse une extrémité dont les coordonnées ne désignent pas un point de la Terre.
 *
 * Deuxième ligne de défense : les DTO valident déjà les entrées HTTP (C4), mais
 * un appel interne fautif enverrait sinon des coordonnées absurdes au moteur et
 * produirait une absence de résultat difficile à diagnostiquer.
 */
function assertValidEndpoint(endpoint: TransitEndpoint, field: 'from' | 'to'): void {
  const { lat, lng } = endpoint;
  const valid =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  if (!valid) {
    throw new BadRequestException(`Coordonnées invalides pour « ${field} ».`);
  }
}

/** Interprète l'instant de départ demandé ; « maintenant » par défaut. */
function parseDeparture(departureAt: string | undefined): Date {
  if (!departureAt) return new Date();

  const parsed = new Date(departureAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('`departureAt` doit être une date ISO 8601 valide.');
  }
  return parsed;
}

/** Borne le nombre de trajets demandés au moteur. */
function clampMaxResults(maxResults: number | undefined): number {
  if (maxResults === undefined || !Number.isInteger(maxResults)) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(maxResults, 1), MAX_RESULTS_LIMIT);
}
