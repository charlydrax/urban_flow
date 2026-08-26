import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { TransportMode } from '../../common/enums/transport-mode.enum';
import { UsersService } from '../users/users.service';
import { ItineraryDto, PlanRoutesResponseDto } from './dto/itinerary.dto';
import { PlaceDto, PlanRouteDto } from './dto/plan-route.dto';
import { SourceCollectorService, type RouteEndpoint } from './sources/source-collector.service';

/**
 * Service Itinéraire (F2) — cœur du flux de référence (CLAUDE.md section 4).
 *
 * État d'avancement :
 * 1. ✅ Lecture des préférences profil (PostGIS) — étape 3.
 * 2. ✅ Appels PARALLÈLES aux trois sources GTFS / GBFS / PostGIS via
 *    `Promise.allSettled`, avec dégradation gracieuse — étapes 13-18, UF-305, C10.
 * 3. ⏳ Fusion en itinéraires multimodaux ; 404 si aucun trajet — Sprint 4.
 * 4. ⏳ `computeFootprint(segments)` du Service Carbone par itinéraire.
 * 5. ⏳ Sauvegarde `search_history`.
 *
 * ⚠️ Les **itinéraires restent des mocks** conformes au scénario nominal
 * (Part-Dieu → Bellecour) jusqu'à la fusion. En revanche, le champ `sources` de
 * la réponse est, lui, bien réel : il rapporte l'état effectif des trois
 * sources pour la recherche demandée. C'est ce qui rend la dégradation
 * gracieuse observable dès maintenant, sans attendre le Sprint 4.
 *
 * Couvre : F2, C4 (identité du JWT, entrées validées), C9 (GeoJSON),
 * C10 (appels parallèles, dégradation gracieuse), C12 (préférence PMR).
 */
@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private readonly users: UsersService,
    private readonly collector: SourceCollectorService,
  ) {}

  /**
   * Calcule les itinéraires multimodaux entre deux lieux.
   *
   * Les préférences sont lues **avant** la collecte et non en parallèle d'elle :
   * elles en sont une entrée (la préférence PMR change la requête envoyée à
   * OpenTripPlanner — C12). Les paralléliser reviendrait à interroger le moteur
   * avant de savoir quoi lui demander.
   *
   * Une panne de la base à cette étape n'est **pas** dégradée : sans profil, on
   * ne sait pas quels itinéraires l'usager accepte, et en inventer serait pire
   * que d'échouer. La dégradation gracieuse commence à la collecte.
   *
   * @param dto Requête validée { from, to, userId } (C4)
   * @param userId Identité issue du JWT vérifié — prime sur dto.userId (anti-IDOR, C4)
   * @returns Itinéraires triés par empreinte croissante, et l'état des trois sources
   * @throws {BadRequestException} si une extrémité n'a pas de coordonnées
   */
  async plan(dto: PlanRouteDto, userId: string): Promise<PlanRoutesResponseDto> {
    const from = toEndpoint(dto.from, 'départ');
    const to = toEndpoint(dto.to, 'arrivée');

    // Étape 3 du flux : les préférences viennent du compte du JWT, jamais du
    // corps de la requête (anti-IDOR — C4).
    const preferences = await this.users.getPreferences(userId);

    // Étapes 13-18 : les trois sources en parallèle (UF-305).
    const collected = await this.collector.collectAllSources(from, to, {
      reducedMobility: preferences.reducedMobility,
    });

    if (collected.allSourcesFailed) {
      // Aucune exception : les trois sources muettes restent une réponse
      // valide, avec une liste vide et un `sources` qui dit pourquoi. Un 500
      // ferait croire à un défaut de la requête de l'usager (C10).
      this.logger.warn('Aucune source disponible : réponse sans itinéraire.');
      return {
        itineraries: [],
        sortedBy: 'carbonAsc',
        sources: this.collector.toAvailability(collected),
      };
    }

    // TODO(Sprint 4) : fusionner `collected` en itinéraires réels, calculer le
    // CO₂ par segment puis enregistrer la recherche dans `search_history`.
    const itineraries = this.buildMockItineraries(dto.from.label, dto.to.label);

    // Tri par empreinte croissante : oriente l'usager vers les mobilités douces
    itineraries.sort((a, b) => a.carbonGrams - b.carbonGrams);

    return {
      itineraries,
      sortedBy: 'carbonAsc',
      sources: this.collector.toAvailability(collected),
    };
  }

  /** Construit trois options multimodales factices reflétant le scénario nominal. */
  private buildMockItineraries(fromLabel: string, toLabel: string): ItineraryDto[] {
    return [
      {
        id: 'itin-bike',
        summary: 'Vélo en libre-service',
        durationMinutes: 16,
        distanceMeters: 3600,
        carbonGrams: 0,
        accessible: false,
        segments: [
          {
            mode: TransportMode.BIKE,
            from: fromLabel,
            to: toLabel,
            durationMinutes: 16,
            distanceMeters: 3600,
            carbonGrams: 0,
          },
        ],
        geometry: {
          type: 'LineString',
          coordinates: [
            [4.8596, 45.7605],
            [4.832, 45.7578],
          ],
        },
      },
      {
        id: 'itin-metro',
        summary: 'Marche + Métro B',
        durationMinutes: 18,
        distanceMeters: 4100,
        carbonGrams: 14,
        accessible: true,
        segments: [
          {
            mode: TransportMode.WALK,
            from: fromLabel,
            to: 'Gare Part-Dieu',
            durationMinutes: 5,
            distanceMeters: 400,
            carbonGrams: 0,
          },
          {
            mode: TransportMode.METRO,
            from: 'Gare Part-Dieu',
            to: 'Saxe-Gambetta',
            durationMinutes: 8,
            distanceMeters: 3200,
            carbonGrams: 12,
            line: 'Métro B',
          },
          {
            mode: TransportMode.WALK,
            from: 'Saxe-Gambetta',
            to: toLabel,
            durationMinutes: 5,
            distanceMeters: 500,
            carbonGrams: 2,
          },
        ],
        geometry: {
          type: 'LineString',
          coordinates: [
            [4.8596, 45.7605],
            [4.8473, 45.7488],
            [4.832, 45.7578],
          ],
        },
      },
      {
        id: 'itin-bus',
        summary: 'Bus C3',
        durationMinutes: 25,
        distanceMeters: 4400,
        carbonGrams: 290,
        accessible: true,
        segments: [
          {
            mode: TransportMode.BUS,
            from: fromLabel,
            to: toLabel,
            durationMinutes: 25,
            distanceMeters: 4400,
            carbonGrams: 290,
            line: 'C3',
          },
        ],
        geometry: {
          type: 'LineString',
          coordinates: [
            [4.8596, 45.7605],
            [4.832, 45.7578],
          ],
        },
      },
    ];
  }
}

/**
 * Exige des coordonnées sur une extrémité de trajet.
 *
 * Le DTO les accepte facultatives (le contrat du diagramme autorise une saisie
 * purement textuelle), mais les trois sources travaillent sur des points : sans
 * coordonnées, il n'y a rien à interroger. Le géocodage est fait en amont, côté
 * client (UF-203) — un label seul est donc un défaut d'appel, pas une panne, et
 * mérite un `400` explicite plutôt qu'une liste vide inexplicable.
 */
function toEndpoint(place: PlaceDto, role: string): RouteEndpoint {
  if (typeof place.lat !== 'number' || typeof place.lng !== 'number') {
    throw new BadRequestException(
      `Le point de ${role} doit porter des coordonnées (lat, lng) : le géocodage est fait par le client.`,
    );
  }
  return { label: place.label, lat: place.lat, lng: place.lng };
}
