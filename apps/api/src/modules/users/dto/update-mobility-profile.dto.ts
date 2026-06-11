import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import { TransportMode } from '../../../common/enums/transport-mode.enum';

export { TransportMode };

/**
 * Préférences de mobilité de l'utilisateur (F1) — pilotent le planificateur (F2).
 * Validation serveur systématique (C4) ; le champ PMR alimente la contrainte C12
 * (itinéraires accessibles aux personnes à mobilité réduite).
 */
export class UpdateMobilityProfileDto {
  /** Modes de transport que l'utilisateur accepte dans ses itinéraires. */
  @ApiProperty({
    enum: TransportMode,
    isArray: true,
    example: [TransportMode.METRO, TransportMode.BIKE],
  })
  @IsArray()
  @ArrayUnique()
  @IsEnum(TransportMode, { each: true })
  preferredModes!: TransportMode[];

  /** Besoin d'itinéraires accessibles PMR (C12) — donnée sensible, minimisée (C8). */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  reducedMobility?: boolean;

  /** Durée de marche maximale acceptée par segment, en minutes. */
  @ApiPropertyOptional({ minimum: 0, maximum: 60, default: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  maxWalkMinutes?: number;
}
