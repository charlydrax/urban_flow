import { ApiProperty } from '@nestjs/swagger';
import type { CarbonTrip, CarbonTripsPage } from '@urbanflow/shared';

import { CarbonModeTotalsDto } from './carbon-summary.dto';

/**
 * Un trajet valorisé, tel que l'affiche le tableau « Détail par trajet » de la
 * planche (UF-805) et tel que l'export le reprend.
 *
 * RGPD (C8) : chaque ligne décrit un déplacement daté, avec ses deux
 * extrémités. C'est la donnée la plus identifiante que publie le module carbone
 * — d'où la même règle que partout ailleurs ici : elle ne sort que vers le
 * porteur du token, et disparaît avec le compte.
 */
export class CarbonTripDto implements CarbonTrip {
  /** Identifiant de la ligne d'historique dont ce trajet est issu. */
  @ApiProperty({ format: 'uuid' })
  id!: string;

  /** Horodatage de la recherche (ISO 8601 — C9). */
  @ApiProperty({ format: 'date-time', example: '2026-08-28T07:42:00.000Z' })
  createdAt!: string;

  /** Libellé du départ, tel que saisi. */
  @ApiProperty({ example: 'République' })
  fromLabel!: string;

  /** Libellé de l'arrivée. */
  @ApiProperty({ example: 'Bellecour' })
  toLabel!: string;

  /**
   * Résumé de l'option retenue. `null` sur un trajet valorisé avant que le
   * champ n'existe — l'écran affiche alors les modes plutôt qu'une phrase vide.
   */
  @ApiProperty({ nullable: true, example: 'Marche + Métro B' })
  selectedSummary!: string | null;

  /** Modes empruntés, du plus émetteur au moins émetteur. */
  @ApiProperty({ type: [CarbonModeTotalsDto] })
  modes!: CarbonModeTotalsDto[];

  /**
   * Distance totale parcourue, en mètres — somme des distances par mode.
   *
   * `0` pour un trajet retenu avant UF-805 : sa ventilation n'a jamais été
   * écrite. L'écran l'affiche comme inconnue plutôt que comme nulle, un trajet
   * de zéro kilomètre n'ayant pas de sens.
   */
  @ApiProperty({ example: 5_100 })
  distanceMeters!: number;

  /** CO₂ émis par le trajet, en grammes. */
  @ApiProperty({ example: 204 })
  emittedGrams!: number;

  /** Ce que le même trajet aurait coûté seul en voiture, en grammes. */
  @ApiProperty({ example: 1_112 })
  carEquivalentGrams!: number;

  /** Écart entre les deux, jamais négatif. */
  @ApiProperty({ example: 908 })
  avoidedGrams!: number;
}

/** Réponse de `GET /api/carbon/trips` (UF-805). */
export class CarbonTripsPageDto implements CarbonTripsPage {
  /** Trajets valorisés de la période, du plus récent au plus ancien. */
  @ApiProperty({ type: [CarbonTripDto] })
  trips!: CarbonTripDto[];

  /**
   * `true` quand la période comptait plus de trajets que le plafond servi.
   *
   * Publié parce que l'export se construit à partir de cette liste : un relevé
   * incomplet qui ne se présenterait pas comme tel serait un faux relevé.
   */
  @ApiProperty({ example: false })
  truncated!: boolean;
}
