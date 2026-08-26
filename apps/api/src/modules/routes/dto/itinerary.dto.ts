import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  Itinerary,
  ItinerarySortKey,
  PlanRoutesResponse,
  RouteSegment,
  SourceAvailability,
} from '@urbanflow/shared';

import { TransportMode } from '../../../common/enums/transport-mode.enum';

/**
 * Segment d'un itinéraire multimodal (une portion effectuée avec un seul mode).
 * Le CO₂ est calculé segment par segment par le Service Carbone (étape 6 du flux).
 * Implémente le contrat partagé `RouteSegment` (@urbanflow/shared) : toute
 * divergence front/back est détectée à la compilation (C9).
 */
export class RouteSegmentDto implements RouteSegment {
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
export class ItineraryDto implements Itinerary {
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

/**
 * État d'une des trois sources interrogées par le planificateur (UF-305).
 *
 * Exposé parce que le client ne peut pas le deviner : une liste sans option
 * vélo peut signifier « aucun vélo praticable ici » ou « l'opérateur n'a pas
 * répondu », et ce n'est pas la même chose à annoncer à l'usager.
 */
export class SourceAvailabilityDto implements SourceAvailability {
  @ApiProperty({
    enum: ['transit', 'sharedMobility', 'cyclePaths'],
    example: 'transit',
    description:
      'Source interrogée : GTFS (`transit`), GBFS (`sharedMobility`) ou PostGIS (`cyclePaths`).',
  })
  source!: SourceAvailability['source'];

  @ApiProperty({
    example: true,
    description: 'Faux quand la source n’a rien pu fournir pour cette recherche.',
  })
  available!: boolean;

  @ApiPropertyOptional({
    enum: ['timeout', 'network', 'upstream-error', 'internal-error'],
    description:
      'Cause générique, renseignée uniquement si `available` vaut `false`. Le détail ' +
      'technique reste dans les logs du serveur : il n’apprendrait rien à l’usager et ' +
      'exposerait notre topologie (C11).',
  })
  reason?: SourceAvailability['reason'];
}

/**
 * Réponse de `POST /api/routes/plan` (étape 8 du flux : 200 + itinéraires + CO₂).
 *
 * Depuis UF-305, elle porte aussi l'état des trois sources : un `200` avec une
 * liste vide et trois sources indisponibles n'est pas la même réponse qu'un
 * `200` avec une liste vide et trois sources en bonne santé.
 */
export class PlanRoutesResponseDto implements PlanRoutesResponse {
  /** Itinéraires proposés, triés par empreinte carbone croissante (mobilité douce d'abord). */
  @ApiProperty({ type: [ItineraryDto] })
  itineraries!: ItineraryDto[];

  /**
   * Clé de tri appliquée par le serveur, déduite de la priorité du profil (F1).
   *
   * Publiée plutôt que sous-entendue : le client doit pouvoir annoncer
   * « classés par empreinte » ou « classés par durée » sans relire les
   * préférences de l'usager ni deviner l'ordre en comparant les valeurs.
   */
  @ApiProperty({
    enum: ['carbonAsc', 'durationAsc'],
    example: 'carbonAsc',
    description:
      '`carbonAsc` pour un profil « écolo » (défaut du produit), `durationAsc` pour « rapide ».',
  })
  sortedBy!: ItinerarySortKey;

  /**
   * État des trois sources pour cette recherche (UF-305).
   *
   * Toujours présent, même quand tout va bien : trois sources `available`
   * signifient que la liste est complète, ce que le client ne peut pas déduire
   * d'un tableau d'itinéraires. C'est ce qui alimente le bandeau
   * « mode dégradé » (C10).
   */
  @ApiProperty({
    type: [SourceAvailabilityDto],
    description:
      'Une entrée par source, dans l’ordre du flux. Une liste sans option vélo et une ' +
      'source `sharedMobility` indisponible ne se lisent pas pareil.',
  })
  sources!: SourceAvailabilityDto[];
}
