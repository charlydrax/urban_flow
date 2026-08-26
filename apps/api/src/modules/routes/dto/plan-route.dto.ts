import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Place, PlanRouteRequest } from '@urbanflow/shared';
import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Lieu de départ ou d'arrivée d'une recherche d'itinéraire.
 * Le label permet la saisie texte (« Part-Dieu ») ; les coordonnées proviennent
 * de la Geolocation API du client (étape 1 du flux de référence — C6).
 */
export class PlaceDto implements Place {
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
 * Corps de `POST /api/routes/plan` — **deux extrémités, rien d'autre** (UF-402).
 *
 * ⚠️ Sécurité (C4 / OWASP A01) : il n'y a **plus de `userId`**. Le diagramme de
 * séquence du MVP en portait un, et l'endpoint de préfiguration l'acceptait en
 * l'ignorant ; le laisser dans le contrat définitif entretenait l'idée qu'on
 * peut désigner un compte depuis le corps de la requête. L'auteur d'une
 * recherche est toujours le porteur du JWT vérifié — préférences lues et
 * historique écrit sur ce compte, sur lui seul.
 *
 * Le `ValidationPipe` global (`whitelist` + `forbidNonWhitelisted`) transforme
 * la suppression en garde active : une requête qui envoie encore un `userId`
 * échoue en `400` au lieu d'être silencieusement acceptée. C'est exactement la
 * recette 2 du ticket, et c'est déjà le contrat de
 * `POST /api/search-history` (UF-204) — les deux écritures de trajet parlent
 * ainsi le même langage.
 */
export class PlanRouteDto implements PlanRouteRequest {
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
}
