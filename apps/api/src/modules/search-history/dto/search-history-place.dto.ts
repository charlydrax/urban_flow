import { ApiProperty } from '@nestjs/swagger';
import type { SearchHistoryPlace } from '@urbanflow/shared';
import { IsLatitude, IsLongitude, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Extrémité d'un trajet enregistré (UF-204).
 *
 * Les coordonnées sont **obligatoires**, à la différence de `PlaceDto` côté
 * planificateur : la colonne PostGIS est `NOT NULL`, et une ligne d'historique
 * sans point ne pourrait être ni rejouée ni affichée sur la carte.
 *
 * Depuis UF-807, cette classe ne sert plus qu'en **lecture** (`SearchHistoryEntryDto`) :
 * les extrémités sont écrites par `POST /api/routes/plan`, seul créateur de
 * lignes d'historique. Elle garde ses décorateurs de validation parce qu'elle
 * documente aussi le format publié dans Swagger (C9), et qu'un contrat de
 * lecture qui mentirait sur ses bornes n'aiderait aucun client.
 */
export class SearchHistoryPlaceDto implements SearchHistoryPlace {
  /** Adresse telle qu'affichée à l'utilisateur (ex. « Place Bellecour, Lyon 2e »). */
  @ApiProperty({ example: 'Place Bellecour, 69002 Lyon' })
  @IsString()
  @MinLength(1)
  // Borne alignée sur `PlaceDto` : au-delà, c'est un abus, pas une adresse (C4).
  @MaxLength(200)
  label!: string;

  /** Latitude WGS84 (SRID 4326) — stockée dans la géométrie PostGIS. */
  @ApiProperty({ example: 45.7578 })
  @IsLatitude()
  lat!: number;

  /** Longitude WGS84 (SRID 4326). */
  @ApiProperty({ example: 4.832 })
  @IsLongitude()
  lng!: number;
}
