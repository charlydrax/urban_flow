import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Lieu de départ ou d'arrivée d'une recherche d'itinéraire.
 * Le label permet la saisie texte (« Part-Dieu ») ; les coordonnées proviennent
 * de la Geolocation API du client (étape 1 du flux de référence — C6).
 */
export class PlaceDto {
  /** Nom du lieu tel que saisi ou résolu (ex. "Part-Dieu"). */
  @ApiProperty({ example: 'Part-Dieu' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  /** Latitude WGS84 (optionnelle si le label doit être géocodé côté serveur). */
  @ApiPropertyOptional({ example: 45.7605 })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  /** Longitude WGS84. */
  @ApiPropertyOptional({ example: 4.8596 })
  @IsOptional()
  @IsLongitude()
  lng?: number;
}

/**
 * Corps de `POST /api/routes/plan` — contrat défini par le diagramme de séquence
 * du MVP : `{ from, to, userId }` (CLAUDE.md section 4).
 *
 * ⚠️ Sécurité (C4) : `userId` est conservé pour respecter le contrat du diagramme,
 * mais le service utilise TOUJOURS l'identité du JWT vérifié — jamais ce champ —
 * pour lire les préférences et écrire l'historique (anti-IDOR).
 */
export class PlanRouteDto {
  /** Point de départ. */
  @ApiProperty({ type: PlaceDto })
  @ValidateNested()
  @Type(() => PlaceDto)
  from!: PlaceDto;

  /** Point d'arrivée. */
  @ApiProperty({ type: PlaceDto, example: { label: 'Bellecour', lat: 45.7578, lng: 4.832 } })
  @ValidateNested()
  @Type(() => PlaceDto)
  to!: PlaceDto;

  /** Identifiant utilisateur (contrat du diagramme) — supplanté par le JWT côté serveur (C4). */
  @ApiProperty({ example: '00000000-0000-4000-8000-000000000001', format: 'uuid' })
  @IsUUID()
  userId!: string;
}
