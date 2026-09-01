import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_TRAVELLERS,
  MIN_TRAVELLERS,
  TransportMode,
  type Place,
  type PlanRouteRequest,
} from '@urbanflow/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
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
 * recette 2 du ticket, et c'est le contrat de toutes les écritures de trajet
 * du module `search-history` (`/selection`, `/completion`) — elles parlent
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

  /**
   * Instant de départ souhaité (ISO 8601) — chip « heure » du planificateur (UF-804).
   *
   * Facultatif, et c'est le cas courant : absent, le moteur GTFS part de
   * maintenant, comme il le faisait avant ce ticket. Une chaîne illisible est
   * refusée ici en `400` plutôt que d'atteindre le connecteur : le message
   * d'erreur y désigne alors le champ fautif, ce qu'un `Invalid Date` remonté
   * de trois couches plus bas ne fait pas (C10).
   */
  @ApiPropertyOptional({
    example: '2026-09-01T08:30:00+02:00',
    description: 'Départ souhaité. Absent = maintenant.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  departAt?: string;

  /**
   * Nombre de voyageurs — chip « voyageurs » du planificateur (UF-804).
   *
   * Borné des deux côtés (C4) : la borne haute évite qu'un entier arbitraire
   * ne serve à vider systématiquement les options de mobilité partagée, la
   * borne basse qu'un `0` ou un négatif ne désactive silencieusement la
   * contrainte de disponibilité.
   */
  @ApiPropertyOptional({
    example: 1,
    minimum: MIN_TRAVELLERS,
    maximum: MAX_TRAVELLERS,
    description: 'Taille du groupe. Absent = 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_TRAVELLERS)
  @Max(MAX_TRAVELLERS)
  travellers?: number;

  /**
   * Modes retenus pour cette recherche — sélecteur de modes du planificateur
   * (UF-804).
   *
   * Absent, la recherche est celle d'avant le ticket : aucune exclusion. Un
   * tableau **vide** est en revanche une demande explicite — « rien d'autre que
   * la marche » — et non l'absence de filtre ; le `ValidationPipe` ne les
   * confond pas, et le service non plus.
   *
   * `ArrayUnique` n'est pas de la coquetterie : un même mode répété n'ajoute
   * rien et allongerait le message d'`appliedConstraints` renvoyé au client.
   */
  @ApiPropertyOptional({
    isArray: true,
    enum: TransportMode,
    example: [TransportMode.WALK, TransportMode.BIKE, TransportMode.BUS],
    description: 'Modes acceptés. Absent = tous. La marche est toujours admise.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(Object.keys(TransportMode).length)
  @ArrayUnique()
  @IsEnum(TransportMode, { each: true })
  modes?: TransportMode[];
}
