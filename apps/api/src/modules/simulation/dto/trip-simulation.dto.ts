import { ApiProperty } from '@nestjs/swagger';
import type { SimulationTick, TripSimulation } from '@urbanflow/shared';

/**
 * Une position fictive de la trace (UF-701).
 * Implémente le contrat partagé `SimulationTick` : toute divergence front/back
 * est détectée à la compilation (C9).
 */
export class SimulationTickDto implements SimulationTick {
  /** Rang du pas dans la trace, à partir de 0. */
  @ApiProperty({ example: 12 })
  index!: number;

  /** Latitude WGS84 de la position fictive. */
  @ApiProperty({ example: 45.7592 })
  lat!: number;

  /** Longitude WGS84. */
  @ApiProperty({ example: 4.8571 })
  lng!: number;

  /** Index, dans les segments soumis, du segment en cours à ce pas. */
  @ApiProperty({ example: 1 })
  segmentIndex!: number;

  /** Temps écoulé **dans le trajet simulé** à ce pas, en secondes. */
  @ApiProperty({ example: 528 })
  elapsedSeconds!: number;
}

/** Réponse de `POST /api/simulation/trip` — la trace complète, prête à rejouer. */
export class TripSimulationDto implements TripSimulation {
  /** Intervalle réel entre deux pas, en millisecondes. */
  @ApiProperty({ example: 2000 })
  stepIntervalMs!: number;

  /**
   * Positions successives, du départ à la destination. Le dernier pas tombe
   * exactement sur le dernier point du tracé, ce qui fait franchir au guidage
   * son rayon d'arrivée et déclenche tout ce qui en dépend (UF-807).
   */
  @ApiProperty({ type: [SimulationTickDto] })
  ticks!: SimulationTickDto[];
}
