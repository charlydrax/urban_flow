import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_STATION_LIMIT,
  DEFAULT_STATION_RADIUS_METERS,
  MAX_STATION_LIMIT,
  MAX_STATION_RADIUS_METERS,
  TransportMode,
  type NearbyStationsQuery,
  type NearbyStationsResult,
  type SharedMobilityStation,
  type SharedMobilityUnavailableReason,
  type SharedVehicleAvailability,
} from '@urbanflow/shared';
import { IsInt, IsLatitude, IsLongitude, IsOptional, Max, Min } from 'class-validator';

/**
 * Paramètres de `GET /api/transport/stations/nearby`.
 *
 * Les bornes ne sont pas décoratives (C4/C5) : sans plafond sur `radius`, une
 * seule requête ferait transiter tout le réseau d'un opérateur sur un réseau
 * mobile ; sans plancher, la précision d'un GPS urbain rendrait le résultat
 * aléatoire (C6). Le service reborne de son côté — un appel interne ne passe
 * pas par ce DTO (défense en profondeur).
 */
export class NearbyStationsQueryDto implements NearbyStationsQuery {
  /** Latitude WGS84 du point de recherche (position de l'usager, ou d'une extrémité de trajet). */
  @ApiProperty({ example: 45.760515, description: 'Latitude WGS84 du point de recherche.' })
  @IsLatitude()
  lat!: number;

  /** Longitude WGS84 du point de recherche. */
  @ApiProperty({ example: 4.859057, description: 'Longitude WGS84 du point de recherche.' })
  @IsLongitude()
  lng!: number;

  /** Rayon de recherche en mètres — environ six minutes de marche par défaut. */
  @ApiPropertyOptional({
    minimum: 50,
    maximum: MAX_STATION_RADIUS_METERS,
    default: DEFAULT_STATION_RADIUS_METERS,
    description: 'Rayon de recherche en mètres.',
  })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(MAX_STATION_RADIUS_METERS)
  radius?: number;

  /** Nombre maximal de stations retournées. */
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_STATION_LIMIT,
    default: DEFAULT_STATION_LIMIT,
    description: 'Nombre maximal de stations retournées.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_STATION_LIMIT)
  limit?: number;
}

/** Disponibilité d'une catégorie de véhicules, telle qu'exposée par l'API (C9). */
export class SharedVehicleAvailabilityDto implements SharedVehicleAvailability {
  @ApiProperty({ enum: TransportMode, enumName: 'TransportMode', example: TransportMode.BIKE })
  mode!: TransportMode;

  /** Vélo à assistance électrique / trottinette électrique. */
  @ApiProperty({ example: true })
  electric!: boolean;

  @ApiProperty({ example: 3 })
  count!: number;
}

/** Une station en libre-service, telle qu'exposée par l'API (C9). */
export class SharedMobilityStationDto implements SharedMobilityStation {
  @ApiProperty({ example: '3080', description: "Identifiant de la station chez l'opérateur." })
  id!: string;

  @ApiProperty({ example: 'PART-DIEU / VILLETTE' })
  name!: string;

  @ApiProperty({ example: 45.760042 })
  lat!: number;

  @ApiProperty({ example: 4.861734 })
  lng!: number;

  /** Distance à vol d'oiseau depuis le point demandé. */
  @ApiProperty({ example: 142, description: 'Distance à vol d’oiseau, en mètres.' })
  distanceMeters!: number;

  @ApiPropertyOptional({ example: '55 RUE DE LA VILLETTE' })
  address?: string;

  @ApiProperty({ nullable: true, example: 30, description: "Nombre total d'emplacements." })
  capacity!: number | null;

  @ApiProperty({ example: 7, description: 'Véhicules louables, toutes catégories confondues.' })
  vehiclesAvailable!: number;

  @ApiProperty({
    type: [SharedVehicleAvailabilityDto],
    description: 'Détail par catégorie — vide si l’opérateur ne ventile pas sa flotte.',
  })
  vehicles!: SharedVehicleAvailabilityDto[];

  @ApiProperty({ nullable: true, example: 22, description: 'Emplacements libres pour un retour.' })
  docksAvailable!: number | null;

  @ApiProperty({ example: true, description: 'La station loue effectivement.' })
  renting!: boolean;

  @ApiProperty({ example: true, description: 'La station accepte les retours.' })
  returning!: boolean;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    example: '2026-08-26T09:12:00.000Z',
    description: 'Dernier rapport de la station elle-même — sa fraîcheur propre.',
  })
  lastReportedAt!: string | null;
}

/**
 * Réponse de `GET /api/transport/stations/nearby`.
 *
 * Objet enveloppe plutôt que tableau nu (C9) : c'est ce qui permet de porter
 * `status` et `publishedAt` à côté des stations. Une indisponibilité de
 * l'opérateur se lit ici, en `200 OK` avec `status: 'unavailable'` — et non en
 * `503` : du point de vue du client, la requête a bien abouti, c'est le mode
 * « vélo » qui n'est pas proposé cette fois (dégradation gracieuse — C10).
 */
export class NearbyStationsResponseDto implements NearbyStationsResult {
  @ApiProperty({
    enum: ['ok', 'unavailable'],
    example: 'ok',
    description: '`ok` même si aucune station n’est trouvée : ce n’est pas une panne.',
  })
  status!: 'ok' | 'unavailable';

  @ApiProperty({ type: [SharedMobilityStationDto], description: 'Triées par distance croissante.' })
  stations!: SharedMobilityStationDto[];

  @ApiPropertyOptional({
    enum: ['timeout', 'network', 'upstream-error'],
    description: 'Renseigné uniquement quand `status` vaut `unavailable`.',
  })
  unavailableReason?: SharedMobilityUnavailableReason;

  @ApiProperty({ example: 500, description: 'Rayon réellement appliqué, après bornage.' })
  radiusMeters!: number;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    example: '2026-08-26T09:14:35.000Z',
    description: 'Horodatage de publication du flux par l’opérateur — la preuve de fraîcheur.',
  })
  publishedAt!: string | null;
}
