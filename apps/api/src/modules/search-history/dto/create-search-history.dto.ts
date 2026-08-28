import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CreateSearchHistoryPayload, SearchHistoryPlace } from '@urbanflow/shared';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Extrémité d'un trajet à enregistrer (UF-204).
 *
 * Les coordonnées sont **obligatoires**, à la différence de `PlaceDto` côté
 * planificateur : la colonne PostGIS est `NOT NULL`, et laisser passer un
 * trajet sans point produirait une ligne d'historique qu'on ne pourrait ni
 * rejouer ni afficher sur la carte. Le refus est prononcé à l'entrée (400),
 * pas par la base (500).
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

/**
 * Corps de `POST /api/search-history` (étape 18 de la séquence : INSERT search_history).
 *
 * ⚠️ Sécurité (C4) : aucun `userId`. L'auteur de la ligne est **toujours** le
 * porteur du JWT vérifié ; il n'y a donc aucun champ à falsifier pour écrire
 * dans l'historique d'un autre compte (OWASP A01). Combiné au `ValidationPipe`
 * global (`whitelist` + `forbidNonWhitelisted`), envoyer un `userId` fait
 * d'ailleurs échouer la requête en 400.
 */
export class CreateSearchHistoryDto implements CreateSearchHistoryPayload {
  /** Point de départ de la recherche. */
  @ApiProperty({ type: SearchHistoryPlaceDto })
  @ValidateNested()
  @Type(() => SearchHistoryPlaceDto)
  from!: SearchHistoryPlaceDto;

  /** Point d'arrivée de la recherche. */
  @ApiProperty({ type: SearchHistoryPlaceDto })
  @ValidateNested()
  @Type(() => SearchHistoryPlaceDto)
  to!: SearchHistoryPlaceDto;

  /**
   * Résumé de l'option retenue, quand l'utilisateur en a choisi une.
   * Facultatif : une recherche est enregistrée dès sa soumission (étape 18),
   * c'est-à-dire avant que le choix d'itinéraire n'existe.
   */
  @ApiPropertyOptional({ example: 'Marche + Métro B' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  selectedSummary?: string;

  /**
   * Empreinte de l'option retenue, en grammes de CO₂ (jamais négative).
   *
   * ⚠️ Depuis UF-505, ce n'est **pas** le chemin nominal pour valoriser un
   * trajet : `PATCH /api/search-history/:id/selection` fait calculer l'empreinte
   * par le Service Carbone à partir des segments, au lieu de croire un nombre
   * venu du navigateur. Le champ reste au contrat pour les appelants qui
   * connaissent déjà le chiffre — le parcours de la PWA n'en fait pas partie.
   */
  @ApiPropertyOptional({ example: 14, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  carbonGrams?: number;

  /**
   * Référence voiture du même trajet, en grammes de CO₂ (UF-505).
   *
   * Accepté avec les mêmes réserves que `carbonGrams`, et pour la même raison
   * qu'il est stocké : les deux valeurs forment un couple. Une empreinte sans sa
   * référence produirait une ligne dont le tableau de bord ne saurait pas dire
   * ce qu'elle a fait économiser.
   */
  @ApiPropertyOptional({ example: 612, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  carEquivalentGrams?: number;
}
