import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SIMULATION_MAX_POINTS_PER_SEGMENT,
  SIMULATION_MAX_SEGMENTS,
  type LineStringGeometry,
  type SimulateTripRequest,
  type SimulatedSegmentPayload,
} from '@urbanflow/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

/** Bornes du domaine WGS84 — au-delà, ce n'est plus un point de la Terre. */
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/**
 * Vérifie que chaque sommet est bien un couple `[lng, lat]` dans le domaine
 * WGS84 (C4/C9).
 *
 * Écrit à la main parce que `class-validator` ne décrit pas les tuples : ses
 * décorateurs s'appliquent à une valeur, pas au deuxième élément du troisième
 * élément d'un tableau. Sans cette contrainte, `coordinates` n'aurait été
 * validé que sur sa **longueur**, et un `[[null, "x"]]` serait descendu
 * jusqu'à l'interpolation — où il aurait produit des `NaN` silencieux plutôt
 * qu'un `400` franc.
 */
@ValidatorConstraint({ name: 'geoJsonCoordinates' })
export class GeoJsonCoordinatesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    return value.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        typeof pair[0] === 'number' &&
        typeof pair[1] === 'number' &&
        Number.isFinite(pair[0]) &&
        Number.isFinite(pair[1]) &&
        pair[0] >= MIN_LONGITUDE &&
        pair[0] <= MAX_LONGITUDE &&
        pair[1] >= MIN_LATITUDE &&
        pair[1] <= MAX_LATITUDE,
    );
  }

  defaultMessage(): string {
    return 'coordinates must be an array of [longitude, latitude] pairs within the WGS84 domain';
  }
}

/**
 * Tracé GeoJSON d'un segment, validé point par point (UF-701 — C4/C9).
 *
 * Il n'existait jusqu'ici aucun DTO de `LineString` : les géométries ne
 * faisaient que **sortir** de l'API. C'en est la première entrée, et une
 * géométrie entrante est une donnée hostile comme une autre — chaque
 * coordonnée est donc bornée au domaine WGS84, et le nombre de points plafonné.
 */
export class SimulatedGeometryDto implements LineStringGeometry {
  /** Seule valeur admise : la RFC 7946 nomme ce type exactement ainsi (C9). */
  @ApiProperty({ enum: ['LineString'], example: 'LineString' })
  @IsIn(['LineString'])
  type!: 'LineString';

  /**
   * Sommets du tracé, en `[lng, lat]` — ordre GeoJSON, pas l'ordre usuel.
   *
   * `class-validator` ne sait pas décrire un tuple de deux nombres bornés :
   * la vérification élément par élément est donc faite à la main, une fois,
   * dans {@link GeoJsonCoordinatesConstraint}. La borner ici plutôt que dans
   * le service garde le service sur son seul métier — refuser ce qui est mal
   * formé avant qu'aucune logique ne s'exécute (C4).
   */
  @ApiProperty({
    example: [
      [4.8596, 45.7605],
      [4.8571, 45.7592],
    ],
    description: 'Sommets `[lng, lat]` du tracé (RFC 7946).',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(SIMULATION_MAX_POINTS_PER_SEGMENT)
  @Validate(GeoJsonCoordinatesConstraint)
  coordinates!: [number, number][];
}

/** Un segment à rejouer — sa durée donne son rythme, son tracé son chemin. */
export class SimulatedSegmentDto implements SimulatedSegmentPayload {
  /**
   * Durée annoncée du segment, en minutes.
   *
   * Bornée à 24 h : au-delà ce n'est plus un segment de déplacement urbain,
   * et la borne empêche qu'une valeur fabriquée ne déforme la répartition des
   * pas au point de figer la simulation sur un seul segment (C4).
   */
  @ApiProperty({ example: 8, minimum: 0, maximum: 1440 })
  @IsNumber()
  @Min(0)
  @Max(1440)
  durationMinutes!: number;

  /**
   * Tracé du segment. Absent quand le segment n'a pas deux points distincts —
   * même règle que `RouteSegment.geometry`. Un segment sans tracé est traversé
   * sans bouger : son temps s'écoule, la position reste au dernier point connu.
   */
  @ApiPropertyOptional({ type: SimulatedGeometryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SimulatedGeometryDto)
  geometry?: SimulatedGeometryDto;
}

/**
 * Corps de `POST /api/simulation/trip` (UF-701).
 *
 * ⚠️ Aucun `userId`, comme partout ailleurs : le demandeur est le porteur du
 * JWT vérifié, et son rôle est relu en base par le `RolesGuard` (C4).
 */
export class SimulateTripDto implements SimulateTripRequest {
  /**
   * Segments de l'itinéraire à rejouer, dans l'ordre du trajet.
   *
   * Au moins un — une simulation sans segment ne décrit aucun déplacement.
   * Au plus {@link SIMULATION_MAX_SEGMENTS}, même borne que les écritures de
   * trajet (UF-505/UF-807).
   */
  @ApiProperty({ type: [SimulatedSegmentDto] })
  @ValidateNested({ each: true })
  @Type(() => SimulatedSegmentDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(SIMULATION_MAX_SEGMENTS)
  segments!: SimulatedSegmentDto[];
}
