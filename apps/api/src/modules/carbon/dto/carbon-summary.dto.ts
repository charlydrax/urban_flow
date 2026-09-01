import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CARBON_SUMMARY_DAYS,
  DEFAULT_CARBON_SUMMARY_DAYS,
  TransportMode,
  type CarbonGoal,
  type CarbonModeTotals,
  type CarbonPeriodTotals,
  type CarbonSummary,
  type CarbonSummaryDays,
} from '@urbanflow/shared';
import { IsIn, IsInt, IsOptional } from 'class-validator';

/**
 * Paramètres de `GET /api/carbon/summary`.
 *
 * Comme pour l'historique, **aucun filtre par utilisateur** : le périmètre de
 * lecture est celui du JWT et rien d'autre (C4 / OWASP A01 — recette 2 du
 * ticket, « les données sont propres à chaque utilisateur »).
 */
export class CarbonSummaryQueryDto {
  /**
   * Durée de la période affichée, en jours.
   *
   * Liste fermée plutôt que plage libre : chaque valeur est un agrégat que la
   * base doit calculer, et la page n'en propose que trois. Un `?days=100000`
   * ferait balayer tout l'historique d'un compte pour un écran qui n'en
   * afficherait rien (C5, C10).
   */
  @ApiPropertyOptional({
    enum: CARBON_SUMMARY_DAYS,
    default: DEFAULT_CARBON_SUMMARY_DAYS,
    example: DEFAULT_CARBON_SUMMARY_DAYS,
  })
  @IsOptional()
  @IsInt()
  @IsIn([...CARBON_SUMMARY_DAYS])
  days?: CarbonSummaryDays;
}

/** Totaux d'une tranche de temps — période affichée ou barre du graphique (C9). */
export class CarbonPeriodTotalsDto implements CarbonPeriodTotals {
  /** Début de la tranche, inclus. */
  @ApiProperty({ format: 'date-time', example: '2026-07-29T00:00:00.000Z' })
  from!: string;

  /** Fin de la tranche, exclue. */
  @ApiProperty({ format: 'date-time', example: '2026-08-28T00:00:00.000Z' })
  to!: string;

  /** CO₂ réellement émis par les itinéraires retenus, en grammes. */
  @ApiProperty({ example: 13_500 })
  emittedGrams!: number;

  /** Ce que les mêmes trajets auraient coûté seul en voiture, en grammes. */
  @ApiProperty({ example: 56_300 })
  carEquivalentGrams!: number;

  /** Écart entre les deux, jamais négatif. */
  @ApiProperty({ example: 42_800 })
  avoidedGrams!: number;

  /** Nombre de trajets valorisés (option retenue) sur la tranche. */
  @ApiProperty({ example: 12 })
  tripsCount!: number;
}

/**
 * Empreinte cumulée d'un mode sur la période (UF-805) — une barre de la
 * « Répartition des émissions » de la planche.
 */
export class CarbonModeTotalsDto implements CarbonModeTotals {
  /** Mode concerné — porte sa couleur et son pictogramme côté écran. */
  @ApiProperty({ enum: TransportMode, example: TransportMode.BUS })
  mode!: TransportMode;

  /** Distance cumulée sur ce mode, en mètres. */
  @ApiProperty({ example: 42_800 })
  distanceMeters!: number;

  /** CO₂ émis par ce mode sur la période, en grammes. */
  @ApiProperty({ example: 5_900 })
  grams!: number;

  /** Trajets distincts comportant au moins un segment de ce mode. */
  @ApiProperty({ example: 7 })
  tripsCount!: number;
}

/**
 * Objectif carbone ramené à la période affichée (UF-805).
 *
 * L'usager fixe un budget **mensuel** (`PATCH /api/users/me`) ; l'API le
 * proratise à la durée demandée pour que l'écran n'ait aucune arithmétique à
 * refaire — et que les deux côtés ne divergent jamais sur le même objectif.
 */
export class CarbonGoalDto implements CarbonGoal {
  /** Budget mensuel choisi par l'usager, en grammes. */
  @ApiProperty({ example: 16_000 })
  monthlyGrams!: number;

  /** Ce budget ramené à la période affichée, en grammes. */
  @ApiProperty({ example: 16_000 })
  periodGrams!: number;

  /** Émissions déjà constatées sur la période, en grammes. */
  @ApiProperty({ example: 13_500 })
  emittedGrams!: number;

  /**
   * Part du budget consommée, en pourcentage entier. **Non borné à 100** : un
   * dépassement se lit comme tel, la barre de progression se borne à
   * l'affichage.
   */
  @ApiProperty({ example: 84 })
  usedPercent!: number;
}

/**
 * Réponse de `GET /api/carbon/summary` (UF-505) — le suivi carbone personnel.
 *
 * RGPD (C8) : chaque champ est un agrégat des déplacements du **seul** compte
 * porteur du token. Rien ici ne sort vers un autre utilisateur, et tout
 * disparaît avec le compte (suppression en cascade de `search_history`).
 */
export class CarbonSummaryDto implements CarbonSummary {
  /** Totaux de la période demandée. */
  @ApiProperty({ type: CarbonPeriodTotalsDto })
  current!: CarbonPeriodTotalsDto;

  /** Totaux de la période de même durée qui la précède immédiatement. */
  @ApiProperty({ type: CarbonPeriodTotalsDto })
  previous!: CarbonPeriodTotalsDto;

  /**
   * Variation des émissions entre les deux périodes, en pourcentage entier
   * (négatif = baisse). `null` si la période précédente est vide : on ne divise
   * pas par zéro, et « +∞ % » n'est pas une information.
   */
  @ApiProperty({ nullable: true, example: -18 })
  emittedChangePercent!: number | null;

  /** Découpage de la période en tranches égales, de la plus ancienne à la plus récente. */
  @ApiProperty({ type: [CarbonPeriodTotalsDto] })
  buckets!: CarbonPeriodTotalsDto[];

  /**
   * Recherches de la période **non menées à leur terme**, donc absentes des
   * totaux (UF-807) : celles sans itinéraire retenu comme celles dont l'option
   * retenue n'a jamais été parcourue. Publié par honnêteté du chiffre : sans
   * lui, un usager qui cherche beaucoup et se déplace peu croirait à une panne
   * devant un total bas.
   */
  @ApiProperty({ example: 3 })
  uncountedTripsCount!: number;

  /**
   * Empreinte cumulée par mode sur la période — la « Répartition des émissions »
   * de la planche (UF-805). Triée par grammes décroissants ; les modes sans
   * aucun trajet n'y figurent pas.
   */
  @ApiProperty({ type: [CarbonModeTotalsDto] })
  modeBreakdown!: CarbonModeTotalsDto[];

  /**
   * Objectif carbone ramené à la période, `null` si l'usager n'en a pas fixé.
   * Un objectif absent n'est pas un objectif à zéro : l'écran propose alors
   * d'en définir un plutôt que d'annoncer un dépassement.
   */
  @ApiProperty({ type: CarbonGoalDto, nullable: true })
  goal!: CarbonGoalDto | null;
}
