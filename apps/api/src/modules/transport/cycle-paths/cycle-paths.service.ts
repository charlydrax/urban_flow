import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_CYCLE_RADIUS_METERS,
  DEFAULT_CYCLE_SEGMENTS_LIMIT,
  MAX_CYCLE_RADIUS_METERS,
  MAX_CYCLE_SEGMENTS_LIMIT,
  MIN_CYCLE_RADIUS_METERS,
  type CyclePathQueryPoint,
  type CycleSegment,
  type CycleSegmentsResult,
} from '@urbanflow/shared';

import { PrismaService } from '../../../prisma/prisma.service';
import { parseCyclePathGeometry, toCycleFacilityType } from './cycle-path.mapper';

/** Options de recherche, hors point de référence. */
export interface CycleSegmentsOptions {
  /** Rayon de recherche en mètres (défaut : 300, bornes : 50–2000). */
  radiusMeters?: number;
  /** Nombre maximal de tronçons rendus (défaut : 20, plafond : 100). */
  limit?: number;
}

/**
 * Précision du GeoJSON rendu, en décimales de degré.
 *
 * Six décimales valent environ onze centimètres au niveau de Lyon — largement
 * en deçà de la précision du relevé de voirie lui-même. Les neuf décimales par
 * défaut de `ST_AsGeoJSON` décriraient le millimètre et gonfleraient chaque
 * tracé d'un tiers pour une exactitude qui n'existe pas dans la donnée source
 * (C5 : des octets en moins sur un réseau mobile).
 */
const GEOJSON_DECIMALS = 6;

/** Ligne telle que la rend la requête spatiale — les alias SQL fixent ces noms. */
interface CycleSegmentRow {
  sourceId: string;
  name: string | null;
  facilityType: string;
  network: string | null;
  surface: string | null;
  distanceMeters: number;
  lengthMeters: number;
  geojson: string;
}

/**
 * Service des tronçons cyclables et piétons (UF-304) — **troisième source** du
 * `Promise.all` de l'étape 4 du flux de référence, aux côtés de GTFS (UF-302) et
 * GBFS (UF-303).
 *
 * ## Pourquoi celle-ci est en base, et pas au bout d'une API
 *
 * Les deux autres sources décrivent ce qui **circule** : des horaires qui
 * changent chaque jour, des vélos qui bougent à la minute. Le réseau cyclable,
 * lui, décrit ce qui est **construit** : quelques dizaines de tronçons par an.
 * L'importer une fois dans PostGIS plutôt que de l'interroger chez un tiers à
 * chaque recherche supprime une latence réseau et un point de panne du chemin
 * critique du planificateur (C5/C10).
 *
 * C'est aussi ce qui rend `ST_DWithin` pertinent ici et pas ailleurs : la
 * question « quels tronçons dans 300 m » se pose sur 4 700 géométries qu'on
 * possède, là où les stations GBFS arrivent déjà filtrées dans un flux de
 * quelques centaines d'entrées (cf. `shared-mobility.service`, section
 * « haversine en mémoire »).
 *
 * ## Distance au tronçon, pas à un point du tronçon
 *
 * `ST_Distance` sur une `geography(MultiLineString)` rend la distance au point
 * **le plus proche** de la ligne. Une Voie Lyonnaise de deux kilomètres qui
 * passe devant la porte est donc à quelques mètres — ce qu'une distance à son
 * point de départ ou à son centroïde aurait raté complètement.
 *
 * Couvre : F2, C4 (paramètres liés, revalidation des entrées), C5 (bornage du
 * rayon et du volume, précision GeoJSON ajustée), C6 (rayon plancher aligné sur
 * la précision GPS réelle), C9 (GeoJSON standard, contrats partagés),
 * C10 (index GiST), C11 (aucune position journalisée), C12 (revêtement exposé).
 */
@Injectable()
export class CyclePathsService {
  private readonly logger = new Logger(CyclePathsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tronçons cyclables et piétons dans un rayon autour d'un point — étapes 12-13
   * du flux de référence.
   *
   * **Injection SQL (C4/OWASP A03)** : la requête est un *tagged template*
   * `$queryRaw`. Chaque `${…}` devient un paramètre lié côté PostgreSQL, jamais
   * une concaténation — y compris les coordonnées, qui viennent du client.
   *
   * **Index (C10)** : `ST_DWithin` est la seule forme de la requête qui sache
   * exploiter l'index GiST. Écrire `ST_Distance(geom, point) <= radius`
   * donnerait le même résultat mais imposerait un parcours séquentiel : le
   * planificateur paierait 4 700 calculs de distance ellipsoïdale à chaque
   * recherche. La différence est vérifiable en `EXPLAIN` (cf.
   * `docs/cycle-paths-postgis.md`).
   *
   * @param point Point de référence — position de l'usager (C6) ou extrémité d'un trajet
   * @param options Rayon de recherche et nombre maximal de tronçons
   * @returns Tronçons du rayon triés par distance croissante, et la fraîcheur du jeu de données
   * @throws {BadRequestException} si le point n'est pas une position valide sur Terre
   */
  async getCycleSegments(
    point: CyclePathQueryPoint,
    options: CycleSegmentsOptions = {},
  ): Promise<CycleSegmentsResult> {
    assertValidPoint(point);

    const radiusMeters = clampRadius(options.radiusMeters);
    const limit = clampLimit(options.limit);

    // Deux lectures indépendantes, donc lancées ensemble : la date d'import ne
    // dépend pas du point interrogé, l'attendre après la recherche spatiale
    // ajouterait un aller-retour au chemin critique pour rien (C10).
    const [rows, datasetImportedAt] = await Promise.all([
      this.queryNearbySegments(point, radiusMeters, limit),
      this.findDatasetImportDate(),
    ]);

    // Compter, pas localiser : le nombre de tronçons suffit au diagnostic, alors
    // qu'une position journalisée serait une donnée de déplacement (C11).
    this.logger.log(`PostGIS : ${rows.length} tronçon(s) cyclable(s) dans ${radiusMeters} m.`);

    return {
      segments: rows.map((row) => toCycleSegment(row)),
      radiusMeters,
      datasetImportedAt: datasetImportedAt?.toISOString() ?? null,
    };
  }

  /**
   * Recherche spatiale proprement dite.
   *
   * ⚠️ `ST_MakePoint` attend (X, Y), donc **(longitude, latitude)** — l'inverse
   * de l'ordre d'écriture usuel. Le cast final en `geography` est ce qui fait
   * compter `ST_DWithin` en mètres plutôt qu'en degrés ; il est appliqué au
   * *point de la requête*, pas à la colonne, qui est déjà une `geography` :
   * caster la colonne interdirait l'usage de l'index.
   *
   * ⚠️ Le `::int` sur la précision GeoJSON n'est pas décoratif : Prisma lie tout
   * nombre JavaScript en `bigint`, et PostGIS ne déclare `ST_AsGeoJSON` que pour
   * un `integer`. Sans le cast, PostgreSQL répond « function st_asgeojson(
   * geography, bigint) does not exist ». La règle vaut pour tout argument
   * entier attendu par une fonction PostGIS appelée depuis Prisma.
   */
  private queryNearbySegments(
    point: CyclePathQueryPoint,
    radiusMeters: number,
    limit: number,
  ): Promise<CycleSegmentRow[]> {
    return this.prisma.$queryRaw<CycleSegmentRow[]>`
      WITH origin AS (
        SELECT ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography AS geog
      )
      SELECT
        source_id                              AS "sourceId",
        name,
        facility_type                          AS "facilityType",
        network,
        surface,
        ROUND(ST_Distance(geom, origin.geog))::int AS "distanceMeters",
        ROUND(ST_Length(geom))::int                AS "lengthMeters",
        ST_AsGeoJSON(geom, ${GEOJSON_DECIMALS}::int) AS "geojson"
      FROM cycle_paths, origin
      -- Le prédicat indexable (C10) : c'est lui, et lui seul, qui se sert du
      -- GiST posé par la migration UF-304.
      WHERE ST_DWithin(geom, origin.geog, ${radiusMeters})
      -- Le tri porte sur l'ensemble déjà réduit par ST_DWithin : quelques
      -- dizaines de distances exactes, pas 4 700.
      ORDER BY ST_Distance(geom, origin.geog)
      LIMIT ${limit}
    `;
  }

  /**
   * Date du dernier import du jeu de données, `null` si la table est vide.
   *
   * Exposée pour que « aucun aménagement à proximité » ne se confonde pas avec
   * « import jamais lancé » : le premier est une information sur le quartier, le
   * second sur notre installation. Sur 4 700 lignes le `MAX` est un parcours de
   * quelques millisecondes, et l'import est une opération manuelle et rare — un
   * index dédié coûterait plus cher à maintenir qu'il ne ferait gagner.
   */
  private async findDatasetImportDate(): Promise<Date | null> {
    const [row] = await this.prisma.$queryRaw<{ importedAt: Date | null }[]>`
      SELECT MAX(imported_at) AS "importedAt" FROM cycle_paths
    `;
    return row?.importedAt ?? null;
  }
}

/** Projette une ligne SQL sur le contrat d'API partagé (C9). */
function toCycleSegment(row: CycleSegmentRow): CycleSegment {
  return {
    id: row.sourceId,
    name: row.name,
    facilityType: toCycleFacilityType(row.facilityType),
    sourceFacilityType: row.facilityType,
    network: row.network,
    surface: row.surface,
    distanceMeters: row.distanceMeters,
    lengthMeters: row.lengthMeters,
    geometry: parseCyclePathGeometry(row.geojson, row.sourceId),
  };
}

/**
 * Refuse un point dont les coordonnées ne désignent pas un lieu de la Terre.
 *
 * Deuxième ligne de défense, comme dans `SharedMobilityService` : le DTO valide
 * déjà les entrées HTTP (C4), mais le Service Itinéraire appellera ce service
 * directement, sans passer par lui. Sans ce garde-fou, une coordonnée aberrante
 * rendrait une liste vide impossible à distinguer d'un quartier sans piste.
 */
function assertValidPoint(point: CyclePathQueryPoint): void {
  const { lat, lng } = point;
  const valid =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  if (!valid) {
    throw new BadRequestException('Coordonnées invalides pour la recherche de tronçons cyclables.');
  }
}

/** Borne le rayon demandé entre le plancher GPS et le plafond de rabattement. */
function clampRadius(radiusMeters: number | undefined): number {
  if (radiusMeters === undefined || !Number.isFinite(radiusMeters)) {
    return DEFAULT_CYCLE_RADIUS_METERS;
  }
  return Math.min(
    Math.max(Math.round(radiusMeters), MIN_CYCLE_RADIUS_METERS),
    MAX_CYCLE_RADIUS_METERS,
  );
}

/** Borne le nombre de tronçons rendus (C5). */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit)) return DEFAULT_CYCLE_SEGMENTS_LIMIT;
  return Math.min(Math.max(limit, 1), MAX_CYCLE_SEGMENTS_LIMIT);
}
