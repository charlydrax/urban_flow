import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CyclePathEndpointsData,
  SharedMobilityEndpointsData,
  SourceDiagnostics,
  SourceDiagnosticsFailure,
  SourceDiagnosticsPlace,
  SourceDiagnosticsQuery,
  SourceDiagnosticsRequest,
  SourceDiagnosticsResponse,
  TransitJourneysResult,
} from '@urbanflow/shared';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * Extrémité d'un diagnostic de sources.
 *
 * Contrairement à `PlaceDto` (planificateur), **les coordonnées sont
 * obligatoires**. Ce n'est pas une divergence : le planificateur garde un
 * `lat`/`lng` facultatif pour respecter le contrat du diagramme de séquence,
 * puis rejette en `400` à l'exécution. Ici, rien n'oblige à ce détour — la
 * contrainte est portée par la validation, donc visible dans Swagger et
 * refusée avant même d'entrer dans le service (C4).
 */
export class SourceEndpointDto implements SourceDiagnosticsPlace {
  /** Nom du lieu, tel que résolu par le géocodage client (UF-203). */
  @ApiProperty({ example: 'Gare Part-Dieu' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;

  /** Latitude WGS84. */
  @ApiProperty({ example: 45.760515 })
  @IsLatitude()
  lat!: number;

  /** Longitude WGS84. */
  @ApiProperty({ example: 4.859057 })
  @IsLongitude()
  lng!: number;
}

/**
 * Corps de `POST /api/routes/sources` (UF-306).
 *
 * ## Deux façons de désigner le trajet, une seule règle
 *
 * Soit les deux extrémités sont fournies, soit un `searchHistoryId` désigne une
 * recherche déjà enregistrée (UF-204) à rejouer. `@ValidateIf` porte cette règle
 * dans la validation plutôt que dans le service : une requête vide est un défaut
 * d'appel, et doit être refusée en `400` avec un message qui dit quoi envoyer —
 * pas traversée jusqu'à une exception plus loin (C4).
 *
 * Rejouer une entrée d'historique n'est pas un raccourci de confort : c'est ce
 * qui permet de sonder **exactement** le trajet que l'usager a demandé, au lieu
 * d'une saisie approchée qui interrogerait d'autres points.
 */
export class TestSourcesDto implements SourceDiagnosticsRequest {
  /** Départ — requis, sauf si `searchHistoryId` est fourni. */
  @ApiPropertyOptional({ type: SourceEndpointDto })
  @ValidateIf((dto: TestSourcesDto) => dto.searchHistoryId === undefined)
  @IsDefined({ message: 'from is required unless searchHistoryId is provided' })
  @ValidateNested()
  @Type(() => SourceEndpointDto)
  from?: SourceEndpointDto;

  /** Arrivée — requise, sauf si `searchHistoryId` est fourni. */
  @ApiPropertyOptional({
    type: SourceEndpointDto,
    example: { label: 'Bellecour', lat: 45.757813, lng: 4.832011 },
  })
  @ValidateIf((dto: TestSourcesDto) => dto.searchHistoryId === undefined)
  @IsDefined({ message: 'to is required unless searchHistoryId is provided' })
  @ValidateNested()
  @Type(() => SourceEndpointDto)
  to?: SourceEndpointDto;

  /**
   * Recherche enregistrée à rejouer (UF-204).
   *
   * Relue dans l'historique du compte du JWT : un identifiant appartenant à
   * quelqu'un d'autre donne un `404`, jamais les données visées (C4).
   */
  @ApiPropertyOptional({ format: 'uuid', example: '2b1f0e6c-8a4a-4c2f-9a3e-1d6b7c8e9f01' })
  @IsOptional()
  @IsUUID()
  searchHistoryId?: string;
}

// ---------------------------------------------------------------- la réponse
//
// Ces classes n'existent que pour que Swagger décrive la réponse (C9). Les
// charges utiles des sources restent typées `object` : elles sont volumineuses,
// déjà documentées par les endpoints de `transport/`, et les redécrire ici les
// ferait diverger au premier changement de connecteur.

/** Cause technique d'une panne de source — publiée pour le diagnostic seul. */
export class SourceFailureDto implements SourceDiagnosticsFailure {
  @ApiProperty({ enum: ['unavailable', 'error', 'timeout'], example: 'unavailable' })
  kind!: 'unavailable' | 'error' | 'timeout';

  @ApiProperty({ example: 'timeout' })
  reason!: string;
}

/** Ce qu'une source a rendu, isolément des deux autres (recette 3 du ticket). */
export class SourceDiagnosticsDto<TData = unknown> implements SourceDiagnostics<TData> {
  @ApiProperty({ enum: ['transit', 'sharedMobility', 'cyclePaths'], example: 'transit' })
  source!: 'transit' | 'sharedMobility' | 'cyclePaths';

  @ApiProperty({ enum: ['ok', 'failed'], example: 'ok' })
  status!: 'ok' | 'failed';

  /** Temps mis par cette source seule — la preuve du parallélisme (C10). */
  @ApiProperty({ example: 1840 })
  elapsedMs!: number;

  @ApiPropertyOptional({ type: SourceFailureDto })
  failure?: SourceFailureDto;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description: 'Charge utile brute du connecteur, `null` si la source a échoué.',
  })
  data!: TData | null;
}

/** Le trajet réellement sondé, et d'où viennent ses extrémités. */
export class SourceDiagnosticsQueryDto implements SourceDiagnosticsQuery {
  @ApiProperty({ type: SourceEndpointDto })
  from!: SourceEndpointDto;

  @ApiProperty({ type: SourceEndpointDto })
  to!: SourceEndpointDto;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  replayedSearchHistoryId!: string | null;
}

/** Préférences appliquées à la collecte, lues sur le compte du JWT (étape 3, C12). */
export class DiagnosticsPreferencesDto {
  @ApiProperty({ example: false })
  reducedMobility!: boolean;
}

/** Les trois sources, brutes et séparées. */
export class DiagnosticsSourcesDto {
  @ApiProperty({ type: SourceDiagnosticsDto })
  transit!: SourceDiagnosticsDto<TransitJourneysResult>;

  @ApiProperty({ type: SourceDiagnosticsDto })
  sharedMobility!: SourceDiagnosticsDto<SharedMobilityEndpointsData>;

  @ApiProperty({ type: SourceDiagnosticsDto })
  cyclePaths!: SourceDiagnosticsDto<CyclePathEndpointsData>;
}

/** Réponse de `POST /api/routes/sources` (UF-306). */
export class TestSourcesResponseDto implements SourceDiagnosticsResponse {
  /** Instant de la collecte (ISO 8601 — C9). */
  @ApiProperty({ example: '2026-08-26T09:12:04.512Z' })
  collectedAt!: string;

  /**
   * Durée totale de la collecte. À comparer au plus grand `elapsedMs` des trois
   * sources : proches = appels parallèles, somme = appels en cascade (C10).
   */
  @ApiProperty({ example: 1875 })
  elapsedMs!: number;

  @ApiProperty({ example: false })
  allSourcesFailed!: boolean;

  @ApiProperty({ type: SourceDiagnosticsQueryDto })
  query!: SourceDiagnosticsQueryDto;

  @ApiProperty({ type: DiagnosticsPreferencesDto })
  preferences!: DiagnosticsPreferencesDto;

  @ApiProperty({ type: DiagnosticsSourcesDto })
  sources!: DiagnosticsSourcesDto;
}
