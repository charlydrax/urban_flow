import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CycleFacilityType,
  DEFAULT_CYCLE_RADIUS_METERS,
  DEFAULT_CYCLE_SEGMENTS_LIMIT,
  MAX_CYCLE_RADIUS_METERS,
  MAX_CYCLE_SEGMENTS_LIMIT,
  MIN_CYCLE_RADIUS_METERS,
  type CyclePathGeometry,
  type CycleSegment,
  type CycleSegmentsQuery,
  type CycleSegmentsResult,
} from '@urbanflow/shared';
import { IsInt, IsLatitude, IsLongitude, IsOptional, Max, Min } from 'class-validator';

/**
 * Paramètres de `GET /api/transport/cycle-paths/nearby`.
 *
 * Mêmes bornes qu'ailleurs et pour les mêmes raisons (C4/C5/C6) : un plafond
 * pour qu'une requête unique n'exporte pas le jeu de données, un plancher aligné
 * sur la précision d'un GPS urbain. Le service reborne de son côté — le Service
 * Itinéraire l'appellera sans passer par ce DTO (défense en profondeur).
 */
export class CycleSegmentsQueryDto implements CycleSegmentsQuery {
  /** Latitude WGS84 du point de recherche (position de l'usager, ou extrémité de trajet). */
  @ApiProperty({ example: 45.760515, description: 'Latitude WGS84 du point de recherche.' })
  @IsLatitude()
  lat!: number;

  /** Longitude WGS84 du point de recherche. */
  @ApiProperty({ example: 4.859057, description: 'Longitude WGS84 du point de recherche.' })
  @IsLongitude()
  lng!: number;

  /** Rayon de recherche en mètres — un aménagement n'aide que s'il est sur le chemin. */
  @ApiPropertyOptional({
    minimum: MIN_CYCLE_RADIUS_METERS,
    maximum: MAX_CYCLE_RADIUS_METERS,
    default: DEFAULT_CYCLE_RADIUS_METERS,
    description: 'Rayon de recherche en mètres.',
  })
  @IsOptional()
  @IsInt()
  @Min(MIN_CYCLE_RADIUS_METERS)
  @Max(MAX_CYCLE_RADIUS_METERS)
  radius?: number;

  /** Nombre maximal de tronçons retournés. */
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_CYCLE_SEGMENTS_LIMIT,
    default: DEFAULT_CYCLE_SEGMENTS_LIMIT,
    description: 'Nombre maximal de tronçons retournés.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CYCLE_SEGMENTS_LIMIT)
  limit?: number;
}

/** Tracé d'un tronçon au format GeoJSON (C9) — affichable tel quel par MapLibre. */
export class CyclePathGeometryDto implements CyclePathGeometry {
  @ApiProperty({ enum: ['MultiLineString'], example: 'MultiLineString' })
  type!: 'MultiLineString';

  @ApiProperty({
    description: 'Brins du tronçon, chacun étant une suite de couples [longitude, latitude].',
    example: [
      [
        [4.8591, 45.7604],
        [4.8598, 45.761],
      ],
    ],
  })
  coordinates!: [number, number][][];
}

/** Un tronçon cyclable ou piéton, tel qu'exposé par l'API (C9). */
export class CycleSegmentDto implements CycleSegment {
  @ApiProperty({ example: '3452', description: 'Identifiant du tronçon chez le producteur.' })
  id!: string;

  @ApiProperty({ nullable: true, example: 'Rue Garibaldi' })
  name!: string | null;

  @ApiProperty({
    enum: CycleFacilityType,
    enumName: 'CycleFacilityType',
    example: CycleFacilityType.CYCLE_TRACK,
    description:
      'Type normalisé. Une piste séparée, une bande peinte et un couloir bus partagé ' +
      "n'offrent pas la même sécurité : la distinction est portée par le contrat, pas déduite.",
  })
  facilityType!: CycleFacilityType;

  @ApiProperty({
    example: 'Piste Cyclable',
    description: "Libellé d'origine du producteur — traçabilité de la normalisation.",
  })
  sourceFacilityType!: string;

  @ApiProperty({ nullable: true, example: 'Voies Lyonnaises' })
  network!: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Matériaux liés (asphaltes, enrobés, bétons et nouveaux liants)',
    description: "Revêtement publié — information d'accessibilité (C12), pas un détail de voirie.",
  })
  surface!: string | null;

  @ApiProperty({
    example: 42,
    description: 'Distance au point le plus proche du tronçon, en mètres.',
  })
  distanceMeters!: number;

  @ApiProperty({
    example: 860,
    description: 'Longueur totale du tronçon — peut dépasser le rayon de recherche.',
  })
  lengthMeters!: number;

  @ApiProperty({ type: CyclePathGeometryDto })
  geometry!: CyclePathGeometryDto;
}

/**
 * Réponse de `GET /api/transport/cycle-paths/nearby`.
 *
 * Pas de champ `status` ici, contrairement aux réponses GTFS et GBFS : cette
 * source est notre propre base. Une panne PostGIS n'est pas une dégradation
 * partielle à signaler poliment dans le corps — c'est une panne de l'API, et le
 * filtre d'exceptions global doit la rendre visible en `500`.
 */
export class CycleSegmentsResponseDto implements CycleSegmentsResult {
  @ApiProperty({ type: [CycleSegmentDto], description: 'Triés par distance croissante.' })
  segments!: CycleSegmentDto[];

  @ApiProperty({ example: 300, description: 'Rayon réellement appliqué, après bornage.' })
  radiusMeters!: number;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    example: '2026-08-26T10:32:00.000Z',
    description:
      "Date du dernier import du jeu de données, `null` si l'import n'a jamais été lancé — " +
      'ce qui distingue « pas d’aménagement ici » de « base non peuplée ».',
  })
  datasetImportedAt!: string | null;
}
