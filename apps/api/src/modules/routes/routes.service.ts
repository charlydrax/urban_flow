import { Injectable } from '@nestjs/common';

import { TransportMode } from '../../common/enums/transport-mode.enum';
import { ItineraryDto, PlanRoutesResponseDto } from './dto/itinerary.dto';
import { PlanRouteDto } from './dto/plan-route.dto';

/**
 * Service Itinéraire (F2) — cœur du flux de référence (CLAUDE.md section 4).
 *
 * ⚠️ SQUELETTE : renvoie des itinéraires mock conformes au scénario nominal
 * (Part-Dieu → Bellecour), déjà triés par CO₂ croissant.
 *
 * Implémentation cible :
 * 1. Lecture des préférences profil (PostGIS) — étape 3.
 * 2. Appels PARALLÈLES via `Promise.all` à GTFS, GBFS et PostGIS
 *    (`ST_DWithin` pour les pistes cyclables proches) — étape 4, C10.
 * 3. Fusion en itinéraires multimodaux ; 404 si aucun trajet — étape 5.
 * 4. `computeFootprint(segments)` du Service Carbone par itinéraire — étape 6.
 * 5. Sauvegarde `search_history` — étape 7.
 * 6. Dégradation gracieuse : une API externe indisponible → son mode est ignoré,
 *    les autres options sont retournées (C10).
 *
 * Couvre : F2, C9 (GeoJSON), C10 (appels parallèles, dégradation), C12 (champ accessible).
 */
@Injectable()
export class RoutesService {
  /**
   * Calcule les itinéraires multimodaux entre deux lieux (stub).
   * @param dto Requête validée { from, to, userId } (C4)
   * @param userId Identité issue du JWT vérifié — prime sur dto.userId (anti-IDOR, C4)
   * @returns Itinéraires avec leur empreinte CO₂, triés par empreinte croissante
   */
  async plan(dto: PlanRouteDto, userId: string): Promise<PlanRoutesResponseDto> {
    // TODO(F2): Promise.all([gtfs, gbfs, postgis ST_DWithin]) + fusion + carbone + historique
    void userId;
    const itineraries = this.buildMockItineraries(dto.from.label, dto.to.label);

    // Tri par empreinte croissante : oriente l'usager vers les mobilités douces
    itineraries.sort((a, b) => a.carbonGrams - b.carbonGrams);

    return { itineraries, sortedBy: 'carbonAsc' };
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
