/**
 * Géocodage d'adresses (UF-203) — étape amont du flux de référence (F2).
 *
 * Convertit une saisie en toutes lettres (« Part-Dieu ») en coordonnées WGS84,
 * qui alimenteront le `{ from, to }` de `POST /api/routes/plan`.
 *
 * ## Pourquoi la BAN plutôt que Nominatim
 *
 * La **Base Adresse Nationale** (api-adresse.data.gouv.fr) est le référentiel
 * officiel français, en licence ouverte :
 * - **sans clé** — rien à stocker, rien à exposer au navigateur (C4) ;
 * - **CORS ouvert** — appelable directement depuis la PWA, sans proxy ;
 * - **conçue pour l'autocomplétion** (`autocomplete=1`), là où la « Tile Usage
 *   Policy » de Nominatim interdit explicitement l'autocomplétion clavier ;
 * - **plus précise en France** : numéros de voie, arrondissements lyonnais.
 *
 * Contrepartie assumée : la couverture s'arrête aux frontières françaises. Pour
 * une métropole française c'est sans conséquence ; un futur besoin transfrontalier
 * demanderait un second géocodeur.
 *
 * ## Ce qui est envoyé, et ce qui ne l'est pas (C8/C11)
 *
 * Seul le **texte tapé** part vers la BAN, sans identifiant de compte, sans
 * cookie (`credentials: 'omit'`) et sans en-tête d'authentification. Le biais
 * géographique transmis est le **centre de Lyon** — une constante publique — et
 * jamais la position réelle de l'utilisateur : chercher « république » ne doit
 * pas révéler à un tiers où se trouve la personne.
 *
 * ## Éco-conception (C5/C10)
 *
 * Le débounce et l'annulation vivent dans le hook appelant
 * (`features/planner/use-address-search.ts`) ; ce module se contente d'accepter
 * un `AbortSignal` et de plafonner le nombre de résultats.
 *
 * Module **pur, sans React** : testable dans l'environnement `node` de Vitest
 * (`geocoding.test.ts`).
 */

/** Point d'entrée de la recherche d'adresses de la BAN (licence ouverte, sans clé). */
export const BAN_SEARCH_URL = 'https://api-adresse.data.gouv.fr/search/';

/** Point d'entrée du géocodage inverse (coordonnées → adresse). */
export const BAN_REVERSE_URL = 'https://api-adresse.data.gouv.fr/reverse/';

/**
 * En dessous de 3 caractères, la BAN refuse la requête (`400`) et le résultat
 * n'aurait de toute façon aucun sens : on n'appelle pas (C5).
 */
export const MIN_QUERY_LENGTH = 3;

/**
 * Nombre de suggestions demandées.
 *
 * Cinq : au-delà, la liste dépasse la hauteur utile d'un écran mobile et la
 * charge de lecture augmente sans gain de pertinence (C2/C7).
 */
export const SUGGESTION_LIMIT = 5;

/**
 * Biais de recherche : centre de la métropole, entre Part-Dieu et Bellecour.
 * Transmis à la BAN en `lat`/`lon` pour classer les homonymes par proximité —
 * « république » doit proposer Lyon avant Paris.
 */
export const LYON_BIAS = { lat: 45.758, lng: 4.8357 } as const;

/**
 * Emprise retenue pour la métropole de Lyon (WGS84).
 *
 * Volontairement **large** — elle englobe les 59 communes du Grand Lyon et
 * quelques communes limitrophes — parce qu'un trajet part rarement du centre
 * exact : refuser Villeurbanne, Vénissieux ou Bron rendrait l'outil inutilisable.
 * Elle sert de filtre final, après le biais de proximité, pour écarter les
 * homonymes lointains que la BAN remonte quand la saisie est ambiguë.
 */
export const LYON_BBOX = {
  minLat: 45.6,
  maxLat: 45.92,
  minLng: 4.63,
  maxLng: 5.06,
} as const;

/**
 * Adresse résolue — c'est cet objet qui est mémorisé à la sélection
 * (recette 2 du ticket) et qui deviendra le `Place` de `POST /routes/plan`.
 */
export interface GeocodedPlace {
  /** Identifiant BAN (`69382_8078_00014`) — clé de liste stable, jamais affichée. */
  id: string;
  /** Libellé complet : « 14 Rue de la République 69002 Lyon ». */
  label: string;
  /** Précision secondaire affichée en gris : « Lyon 2e Arrondissement · Rhône ». */
  context: string;
  /** Latitude WGS84 (EPSG:4326 — C9). */
  lat: number;
  /** Longitude WGS84. */
  lng: number;
}

/** Cause d'échec normalisée — `aborted` n'est pas une erreur à afficher. */
export type GeocodingFailureReason = 'aborted' | 'network' | 'service';

/** Résultat normalisé d'une recherche : jamais d'exception qui remonte à l'UI. */
export type GeocodingResult =
  | { ok: true; places: GeocodedPlace[] }
  | { ok: false; reason: GeocodingFailureReason };

/**
 * Messages affichés pour chaque échec (C7) — UI en français.
 *
 * Aucun ne bloque le formulaire : la saisie libre reste toujours possible, comme
 * pour la géolocalisation (`lib/geolocation.ts`). `aborted` n'a pas de message :
 * une requête annulée par une frappe suivante n'est pas un incident.
 */
export const GEOCODING_ERROR_MESSAGES: Record<
  Exclude<GeocodingFailureReason, 'aborted'>,
  string
> = {
  network:
    'La recherche d’adresses est indisponible (vous semblez hors ligne). Vous pouvez saisir votre adresse à la main.',
  service:
    'Le service d’adresses ne répond pas pour le moment. Réessayez dans un instant, ou saisissez votre adresse à la main.',
};

/** Une entité GeoJSON telle que renvoyée par la BAN — champs réellement exploités. */
interface BanFeature {
  geometry?: { coordinates?: unknown };
  properties?: {
    id?: unknown;
    label?: unknown;
    context?: unknown;
    city?: unknown;
    district?: unknown;
  };
}

/**
 * Construit l'URL de recherche BAN.
 *
 * `autocomplete=1` : la BAN complète le dernier mot au lieu d'exiger un terme
 * entier — indispensable pour proposer « République » dès « répu ».
 * `lat`/`lon` : biais de proximité sur Lyon (voir `LYON_BIAS`).
 *
 * Exporté pour être vérifié en test sans appel réseau.
 *
 * @param query Texte saisi par l'utilisateur
 * @param limit Nombre maximal de suggestions (défaut `SUGGESTION_LIMIT`)
 */
export function buildSearchUrl(query: string, limit: number = SUGGESTION_LIMIT): string {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    autocomplete: '1',
    lat: String(LYON_BIAS.lat),
    lon: String(LYON_BIAS.lng),
  });
  return `${BAN_SEARCH_URL}?${params.toString()}`;
}

/** Construit l'URL de géocodage inverse (coordonnées → adresse la plus proche). */
export function buildReverseUrl(lat: number, lng: number): string {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lng) });
  return `${BAN_REVERSE_URL}?${params.toString()}`;
}

/**
 * Vrai si le point tombe dans l'emprise de la métropole de Lyon.
 *
 * Le biais BAN *classe* les résultats, il ne les *restreint* pas : sur une
 * saisie ambiguë (« gare »), des adresses de toute la France remontent quand
 * même. Ce filtre applique la restriction demandée par le ticket.
 */
export function isWithinLyonArea(lat: number, lng: number): boolean {
  return (
    lat >= LYON_BBOX.minLat &&
    lat <= LYON_BBOX.maxLat &&
    lng >= LYON_BBOX.minLng &&
    lng <= LYON_BBOX.maxLng
  );
}

/**
 * Ramène une entité BAN à un `GeocodedPlace`, ou `null` si elle est inexploitable.
 *
 * Défensif par principe (C4) : une réponse externe n'est jamais supposée bien
 * formée, et une entité sans coordonnées utilisables doit disparaître de la
 * liste plutôt que de produire un `NaN` qui poserait un marqueur au large.
 * Rappel d'ordre : GeoJSON écrit `[lng, lat]`, l'inverse de l'usage courant (C9).
 */
export function normalizeFeature(feature: BanFeature): GeocodedPlace | null {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const [lng, lat] = coordinates as unknown[];
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const properties = feature.properties ?? {};
  const label = typeof properties.label === 'string' ? properties.label : null;
  if (!label) return null;

  return {
    // Identifiant BAN quand il existe ; à défaut les coordonnées, qui
    // distinguent deux entités homonymes (une clé de liste doit rester unique).
    id: typeof properties.id === 'string' ? properties.id : `${lat},${lng}`,
    label,
    context: formatContext(properties),
    lat,
    lng,
  };
}

/**
 * Libellé secondaire de la suggestion.
 *
 * La BAN renvoie un `context` administratif verbeux (« 69, Rhône,
 * Auvergne-Rhône-Alpes ») et, pour Lyon et Marseille, un `district` bien plus
 * parlant (« Lyon 2e Arrondissement ») : on privilégie le second, et on retombe
 * sur le département seul, sans la région, qui n'apporte rien à Lyon.
 */
function formatContext(properties: NonNullable<BanFeature['properties']>): string {
  const district = typeof properties.district === 'string' ? properties.district : null;
  if (district) return district;

  const context = typeof properties.context === 'string' ? properties.context : '';
  const parts = context
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  // « 69, Rhône, Auvergne-Rhône-Alpes » → « Rhône » (index 1 = nom du département).
  return parts[1] ?? parts[0] ?? '';
}

/** Traduit l'échec d'un `fetch` en cause normalisée (une annulation n'est pas une panne). */
function toFailure(error: unknown, signal?: AbortSignal): GeocodingResult {
  if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
    return { ok: false, reason: 'aborted' };
  }
  // `fetch` ne rejette que sur un problème réseau/CORS — jamais sur un 4xx/5xx.
  return { ok: false, reason: 'network' };
}

/**
 * Recherche les adresses correspondant à une saisie, restreintes à Lyon.
 *
 * Ne lève jamais : chaque issue (succès, réseau coupé, service en panne,
 * requête annulée) revient sous forme de `GeocodingResult`.
 *
 * @param query Texte saisi — une saisie plus courte que `MIN_QUERY_LENGTH` renvoie une liste vide sans appel réseau
 * @param signal Permet au hook d'annuler la requête dès la frappe suivante (C5)
 * @returns Les suggestions situées dans l'emprise lyonnaise, ou la cause de l'échec
 */
export async function searchAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodingResult> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return { ok: true, places: [] };

  let response: Response;
  try {
    response = await fetch(buildSearchUrl(trimmed), {
      signal,
      // Service public tiers : aucun cookie de session ne doit fuiter (C11).
      credentials: 'omit',
    });
  } catch (error) {
    return toFailure(error, signal);
  }

  if (!response.ok) return { ok: false, reason: 'service' };

  let payload: { features?: unknown };
  try {
    payload = (await response.json()) as { features?: unknown };
  } catch {
    return { ok: false, reason: 'service' };
  }

  const features = Array.isArray(payload.features) ? payload.features : [];
  const places = features
    .map((feature) => normalizeFeature(feature as BanFeature))
    .filter((place): place is GeocodedPlace => place !== null)
    .filter((place) => isWithinLyonArea(place.lat, place.lng));

  return { ok: true, places };
}

/**
 * Géocodage inverse : coordonnées → adresse la plus proche (UF-202 + UF-203).
 *
 * Sert à remplacer le « Ma position (45.76045, 4.85949) » de la géolocalisation
 * par l'adresse réelle, comme sur la maquette (« Départ · position actuelle →
 * 14 rue de la République, Lyon 2e ») : une adresse est vérifiable d'un coup
 * d'œil, un couple de décimales ne l'est pas (C6 — fiabilité perçue).
 *
 * Renvoie `null` sur tout échec : c'est un **enrichissement**, jamais un
 * prérequis. Sans lui, le libellé en coordonnées reste parfaitement valide.
 *
 * @param lat Latitude WGS84
 * @param lng Longitude WGS84
 * @param signal Annulation si l'écran est quitté avant la réponse
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeocodedPlace | null> {
  try {
    const response = await fetch(buildReverseUrl(lat, lng), { signal, credentials: 'omit' });
    if (!response.ok) return null;

    const payload = (await response.json()) as { features?: unknown };
    const features = Array.isArray(payload.features) ? payload.features : [];
    if (features.length === 0) return null;

    return normalizeFeature(features[0] as BanFeature);
  } catch {
    return null;
  }
}
