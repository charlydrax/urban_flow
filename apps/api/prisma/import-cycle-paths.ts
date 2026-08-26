import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Import des aménagements cyclables de la Métropole de Lyon dans PostGIS (UF-304).
 *
 * ```bash
 * npm run db:import:cycle-paths            # depuis apps/api
 * npm run db:import:cycle-paths -- --dry-run
 * ```
 *
 * ## Pourquoi un script Node et pas `ogr2ogr`
 *
 * Le ticket évoque « ogr2ogr ou équivalent ». GDAL ferait le travail en une
 * ligne, mais imposerait une dépendance système de plusieurs centaines de
 * mégaoctets, à installer différemment sur chaque poste et sur la CI, pour
 * charger un jeu de 5 Mo. Ce script utilise le client Prisma déjà présent et le
 * `fetch` du runtime : `npm run db:import:cycle-paths` fonctionne partout où le
 * reste du projet fonctionne, sans prérequis supplémentaire.
 *
 * Il fait par ailleurs deux choses qu'`ogr2ogr` ne ferait pas seul : filtrer les
 * aménagements encore à l'état de projet, et réconcilier l'existant plutôt que
 * de vider la table (voir plus bas).
 *
 * ## Idempotence
 *
 * Rejouable sans dupliquer : le rapprochement se fait sur `source_id`
 * (le `gid` du producteur) via `ON CONFLICT DO UPDATE`. Les tronçons absents de
 * la nouvelle version du flux — aménagement supprimé, identifiant fusionné —
 * sont retirés à la fin, reconnaissables à leur `imported_at` resté en arrière.
 *
 * Le tout dans **une seule transaction** : un flux tronqué en cours de
 * téléchargement laisserait sinon une base à moitié peuplée, dans laquelle
 * « aucune piste à proximité » serait un mensonge.
 *
 * ⚠️ Script d'administration : il écrit en masse dans la base. Aucune donnée
 * personnelle n'est concernée (patrimoine public sous Licence Ouverte — C8).
 */

/**
 * Flux WFS ouvert de la Métropole de Lyon, filtré côté serveur sur le format
 * GeoJSON et reprojeté en WGS84 (EPSG:4326) — le SRID de la colonne, celui de
 * la Geolocation API et celui du GeoJSON standard (C6/C9). Le producteur publie
 * nativement en EPSG:3946 (Lambert CC46) : demander la reprojection au serveur
 * évite d'embarquer une bibliothèque de projection côté client.
 */
const DEFAULT_SOURCE_URL =
  'https://data.grandlyon.com/geoserver/metropole-de-lyon/ows' +
  '?SERVICE=WFS&VERSION=2.0.0&request=GetFeature' +
  '&typename=metropole-de-lyon:pvo_patrimoine_voirie.pvoamenagementcyclable' +
  '&outputFormat=application/json&SRSNAME=EPSG:4326';

/**
 * Valeur du champ `validite` marquant un aménagement **réalisé**.
 *
 * Le flux mélange l'existant et le programmé (« En projet ou en cours de
 * validation ») : environ un tronçon sur sept n'est pas encore construit.
 * Proposer à un cycliste une piste qui n'existe pas serait pire qu'une absence
 * d'information — d'où un filtre à l'import plutôt qu'à la requête, pour que la
 * table signifie exactement « les aménagements praticables aujourd'hui ».
 */
const BUILT_STATUS = 'Validé';

/** Le producteur ne délivre pas 5 Mo instantanément ; deux minutes couvrent large. */
const FETCH_TIMEOUT_MS = 120_000;

/**
 * Taille des lots d'insertion.
 *
 * Un `INSERT` unique de 4 000 géométries construirait un paramètre JSON de
 * plusieurs mégaoctets ; un `INSERT` par tronçon paierait 4 000 allers-retours.
 * 250 lignes tiennent dans un paquet réseau ordinaire et l'import complet passe
 * en une vingtaine de requêtes.
 */
const BATCH_SIZE = 250;

/** Les seuls attributs du flux que nous conservons — les vingt autres sont ignorés (C5). */
interface CyclePathFeature {
  sourceId: string;
  name: string | null;
  facilityType: string;
  network: string | null;
  surface: string | null;
  /** Géométrie GeoJSON brute, réinjectée telle quelle dans `ST_GeomFromGeoJSON`. */
  geometry: unknown;
}

/** Forme (partielle) d'une entité du flux WFS — seuls les champs lus sont déclarés. */
interface SourceFeature {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const sourceUrl = process.env.CYCLE_PATHS_SOURCE_URL ?? DEFAULT_SOURCE_URL;

  log(`Téléchargement du flux (${new URL(sourceUrl).host})…`);
  const collection = await fetchFeatureCollection(sourceUrl);
  log(`${collection.length} entité(s) reçue(s).`);

  const features = extractFeatures(collection);
  log(`${features.length} tronçon(s) réalisé(s) retenu(s) après filtrage.`);

  if (features.length === 0) {
    throw new Error(
      'Aucun tronçon exploitable dans le flux : import interrompu pour ne pas vider la table.',
    );
  }

  if (dryRun) {
    log('--dry-run : rien n’a été écrit en base.');
    logSample(features);
    return;
  }

  const importedAt = new Date();
  const stats = await prisma.$transaction(
    async (tx) => {
      let upserted = 0;
      for (let offset = 0; offset < features.length; offset += BATCH_SIZE) {
        upserted += await upsertBatch(tx, features.slice(offset, offset + BATCH_SIZE), importedAt);
      }

      // Les tronçons que ce passage n'a pas touchés ne sont plus dans le flux :
      // aménagement supprimé, ou identifiant refondu côté producteur. Les garder
      // ferait afficher des pistes disparues.
      const removed = await tx.$executeRaw`
        DELETE FROM cycle_paths WHERE imported_at < ${importedAt}
      `;
      return { upserted, removed };
    },
    // Le lot complet dépasse le délai par défaut de Prisma (5 s) : c'est une
    // opération d'administration, pas une requête d'usager.
    { timeout: 300_000 },
  );

  log(`Import terminé : ${stats.upserted} tronçon(s) écrit(s), ${stats.removed} retiré(s).`);
  await logCoverage();
}

/**
 * Télécharge et décode la collection GeoJSON.
 *
 * Le délai est explicite : sans lui, un producteur qui accepte la connexion
 * puis se tait bloquerait le script indéfiniment.
 *
 * @param url Point d'accès WFS renvoyant du `application/json`
 * @returns Les entités brutes de la collection
 */
async function fetchFeatureCollection(url: string): Promise<SourceFeature[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Le flux a répondu HTTP ${response.status} — import interrompu.`);
  }

  const body: unknown = await response.json();
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) {
    // Le WFS répond en XML sur erreur, avec un code 200 : sans ce contrôle, une
    // requête mal formée se solderait par « 0 tronçon » et une table vidée.
    throw new Error('Réponse inattendue : aucune collection GeoJSON exploitable.');
  }
  return features as SourceFeature[];
}

/**
 * Filtre et projette les entités du flux sur les seuls attributs conservés.
 *
 * Trois familles sont écartées, et pour trois raisons distinctes :
 * - les aménagements **en projet** (voir `BUILT_STATUS`) ;
 * - les entités **sans géométrie linéaire** — un tronçon qu'on ne peut pas
 *   tracer ne sert ni à la carte ni à `ST_DWithin` ;
 * - les **doublons de `source_id`**, qui feraient échouer `ON CONFLICT` (« ne
 *   peut affecter deux fois la même ligne ») ; le premier vu l'emporte.
 */
function extractFeatures(collection: SourceFeature[]): CyclePathFeature[] {
  const seen = new Set<string>();
  const features: CyclePathFeature[] = [];

  for (const feature of collection) {
    const properties = feature.properties ?? {};
    if (text(properties.validite) !== BUILT_STATUS) continue;

    const geometryType = feature.geometry?.type;
    if (geometryType !== 'MultiLineString' && geometryType !== 'LineString') continue;

    const sourceId = text(properties.gid);
    const facilityType = text(properties.typeamenagement);
    // Sans identifiant, pas de rapprochement possible au réimport ; sans type,
    // le tronçon ne peut pas être pondéré par le planificateur.
    if (!sourceId || !facilityType || seen.has(sourceId)) continue;
    seen.add(sourceId);

    features.push({
      sourceId,
      name: text(properties.nom) || null,
      facilityType,
      network: text(properties.reseau) || null,
      surface: text(properties.revetementpiste) || null,
      geometry: feature.geometry,
    });
  }

  return features;
}

/**
 * Écrit un lot de tronçons.
 *
 * Le lot part **en un seul paramètre JSON** que PostgreSQL déplie lui-même
 * (`jsonb_array_elements`). Deux bénéfices : le texte SQL est constant, donc
 * sans surface d'injection (C4/OWASP A03) même si les libellés viennent d'une
 * source externe ; et le plan de requête est réutilisé d'un lot à l'autre.
 *
 * `ST_Multi` uniformise en `MultiLineString` les rares entités publiées en
 * `LineString` simple : la colonne n'accepte qu'un type, et le convertir ici
 * évite une exception au milieu de l'import.
 *
 * @returns Le nombre de lignes écrites (insérées ou mises à jour)
 */
function upsertBatch(
  tx: Prisma.TransactionClient,
  batch: CyclePathFeature[],
  importedAt: Date,
): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO cycle_paths (id, source_id, name, facility_type, network, surface, geom, imported_at)
    SELECT
      gen_random_uuid(),
      feature->>'sourceId',
      feature->>'name',
      feature->>'facilityType',
      feature->>'network',
      feature->>'surface',
      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(feature->'geometry'), 4326))::geography,
      ${importedAt}
    FROM jsonb_array_elements(${JSON.stringify(batch)}::jsonb) AS feature
    ON CONFLICT (source_id) DO UPDATE SET
      name          = EXCLUDED.name,
      facility_type = EXCLUDED.facility_type,
      network       = EXCLUDED.network,
      surface       = EXCLUDED.surface,
      geom          = EXCLUDED.geom,
      imported_at   = EXCLUDED.imported_at
  `;
}

/**
 * Journalise ce que la table contient réellement après import.
 *
 * Un compteur de lignes ne prouve pas grand-chose : c'est la validité des
 * géométries et la longueur cumulée qui disent si le jeu de données est
 * exploitable (recette 1 du ticket).
 */
async function logCoverage(): Promise<void> {
  const [summary] = await prisma.$queryRaw<
    { total: bigint; invalid: bigint; kilometers: number | null }[]
  >`
    SELECT
      COUNT(*)                                       AS total,
      COUNT(*) FILTER (WHERE NOT ST_IsValid(geom::geometry)) AS invalid,
      ROUND((SUM(ST_Length(geom)) / 1000)::numeric, 1)::float8 AS kilometers
    FROM cycle_paths
  `;

  log(
    `Table cycle_paths : ${summary.total} tronçon(s), ${summary.kilometers ?? 0} km cumulés, ` +
      `${summary.invalid} géométrie(s) invalide(s).`,
  );
}

/** Aperçu en `--dry-run` : de quoi vérifier le filtrage sans toucher à la base. */
function logSample(features: CyclePathFeature[]): void {
  for (const feature of features.slice(0, 3)) {
    log(`  · ${feature.sourceId} — ${feature.name ?? '(sans nom)'} [${feature.facilityType}]`);
  }
}

/** Rend une valeur du flux sous forme de chaîne nettoyée (le WFS mêle nombres et textes). */
function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[cycle-paths] ${message}`);
}

main()
  .catch((error: unknown) => {
    console.error('[cycle-paths] Import échoué :', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
