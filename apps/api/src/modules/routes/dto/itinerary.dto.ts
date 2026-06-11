import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TransportMode } from '../../../common/enums/transport-mode.enum';

/**
 * Segment d'un itinéraire multimodal (une portion effectuée avec un seul mode).
 * Le CO₂ est calculé segment par segment par le Service Carbone (étape 6 du flux).
 */
export class RouteSegmentDto {
  /** Mode de transport du segment. */
  @ApiProperty({ enum: TransportMode, example: TransportMode.METRO })
  mode!: TransportMode;

  /** Point de départ du segment (label lisible). */
  @ApiProperty({ example: 'Gare Part-Dieu' })
  from!: string;

  /** Point d'arrivée du segment. */
  @ApiProperty({ example: 'Bellecour' })
  to!: string;

  /** Durée estimée du segment, en minutes. */
  @ApiProperty({ example: 8 })
  durationMinutes!: number;

  /** Distance du segment, en mètres. */
  @ApiProperty({ example: 3200 })
  distanceMeters!: number;

  /** Empreinte carbone du segment, en grammes de CO₂ équivalent. */
  @ApiProperty({ example: 12 })
  carbonGrams!: number;

  /** Ligne empruntée le cas échéant (donnée GTFS — C9). */
  @ApiPropertyOptional({ example: 'Métro B' })
  line?: string;
}

/** Itinéraire multimodal complet, prêt à être affiché et trié par le client. */
export class ItineraryDto {
  /** Identifiant de l'itinéraire dans la réponse (référence pour l'historique). */
  @ApiProperty({ example: 'itin-1' })
  id!: string;

  /** Résumé lisible de la combinaison de modes. */
  @ApiProperty({ example: 'Marche + Métro B' })
  summary!: string;

  /** Durée totale, en minutes. */
  @ApiProperty({ example: 18 })
  durationMinutes!: number;

  /** Distance totale, en mètres. */
  @ApiProperty({ example: 4100 })
  distanceMeters!: number;

  /** Empreinte carbone totale en grammes de CO₂ — clé du tri côté client (étape 9 du flux). */
  @ApiProperty({ example: 14 })
  carbonGrams!: number;

  /** Itinéraire accessible PMR (norme transport — C12). */
  @ApiProperty({ example: true })
  accessible!: boolean;

  /** Segments ordonnés composant l'itinéraire. */
  @ApiProperty({ type: [RouteSegmentDto] })
  segments!: RouteSegmentDto[];

  /**
   * Tracé GeoJSON LineString [lng, lat] pour l'affichage MapLibre (format standard — C9).
   * Optionnel tant que le calcul réel n'est pas implémenté.
   */
  @ApiPropertyOptional({
    example: {
      type: 'LineString',
      coordinates: [
        [4.8596, 45.7605],
        [4.832, 45.7578],
      ],
    },
  })
  geometry?: { type: 'LineString'; coordinates: [number, number][] };
}

/** Réponse de `POST /api/routes/plan` (étape 8 du flux : 200 + itinéraires + CO₂). */
export class PlanRoutesResponseDto {
  /** Itinéraires proposés, triés par empreinte carbone croissante (mobilité douce d'abord). */
  @ApiProperty({ type: [ItineraryDto] })
  itineraries!: ItineraryDto[];

  /** Clé de tri appliquée par le serveur (le client peut re-trier). */
  @ApiProperty({ example: 'carbonAsc' })
  sortedBy!: 'carbonAsc';
}
