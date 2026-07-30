import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { RoutePriority } from '../../../common/enums/route-priority.enum';
import { TransportMode } from '../../../common/enums/transport-mode.enum';

export { RoutePriority, TransportMode };

/**
 * Préférences de mobilité modifiables (F1) — pilotent le planificateur (F2).
 *
 * Tous les champs sont **facultatifs** : `PATCH` a une sémantique partielle, un
 * champ absent n'écrase rien en base. Chaque champ reste validé strictement
 * (C4) ; combiné au `ValidationPipe` global (`whitelist` +
 * `forbidNonWhitelisted`), toute clé inconnue fait échouer la requête en 400.
 */
export class MobilityPreferencesDto {
  /** Modes de transport que l'utilisateur accepte dans ses itinéraires. */
  @ApiPropertyOptional({
    enum: TransportMode,
    isArray: true,
    example: [TransportMode.WALK, TransportMode.METRO, TransportMode.BIKE],
  })
  @IsOptional()
  @IsArray()
  // Un profil sans aucun mode ne produirait aucun itinéraire : on refuse la
  // liste vide côté serveur plutôt que de laisser le planificateur échouer.
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(TransportMode, { each: true })
  preferredModes?: TransportMode[];

  /** Arbitrage rapidité / CO₂ appliqué au tri des itinéraires (F2). */
  @ApiPropertyOptional({ enum: RoutePriority, example: RoutePriority.GREENEST })
  @IsOptional()
  @IsEnum(RoutePriority)
  priority?: RoutePriority;

  /** Besoin d'itinéraires accessibles PMR (C12) — donnée sensible, minimisée (C8). */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  reducedMobility?: boolean;

  /** Durée de marche maximale acceptée par segment, en minutes. */
  @ApiPropertyOptional({ minimum: 0, maximum: 60, example: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  maxWalkMinutes?: number;
}

/**
 * Corps de `PATCH /api/users/me` (UF-107) : profil de compte + préférences.
 *
 * L'identité n'y figure volontairement pas : elle est toujours déduite du JWT
 * vérifié (`@CurrentUser`), jamais du corps de la requête — sans quoi n'importe
 * qui pourrait modifier le profil d'autrui en changeant un `userId` (C4/OWASP
 * A01, recette 2 du ticket).
 */
export class UpdateUserProfileDto {
  /**
   * Consentement à la géolocalisation (C6/C8).
   * `true` l'accorde et l'horodate, `false` le révoque — le RGPD impose qu'un
   * consentement soit aussi simple à retirer qu'à donner.
   */
  @ApiPropertyOptional({ description: 'Consentement géolocalisation (RGPD, révocable)' })
  @IsOptional()
  @IsBoolean()
  geolocationConsent?: boolean;

  /** Préférences de mobilité à modifier (partiel). */
  @ApiPropertyOptional({ type: MobilityPreferencesDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MobilityPreferencesDto)
  preferences?: MobilityPreferencesDto;
}
