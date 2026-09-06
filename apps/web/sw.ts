/**
 * Service worker UrbanFlow (C1, C5, C10) — compilé vers public/sw.js (esbuild).
 *
 * Stratégies (cf. flux de référence, étapes 9 et dégradation gracieuse) :
 * - Navigations : network-first avec repli sur le shell en cache → l'app
 *   reste consultable hors-ligne (C1).
 * - `POST /api/routes/plan` : network-first ; chaque réponse réussie est
 *   mémorisée, et si le réseau coupe APRÈS un calcul, le dernier itinéraire
 *   en cache est servi avec l'en-tête `X-UrbanFlow-Cache: last-route` pour
 *   que l'UI affiche un bandeau « résultat hors-ligne » (C10).
 * - Assets statiques Next : cache-first (immutables par hash de build — C5).
 * - Fond de carte déjà consulté : cache-first borné → la carte se redessine
 *   hors-ligne sur la zone déjà parcourue au lieu de rester vide (UF-601).
 *
 * Le tableau complet « ressource → stratégie → pourquoi » est dans
 * `docs/pwa-offline.md` : c'est la référence du dossier, pas ce commentaire.
 */

declare const self: ServiceWorkerGlobalScope & typeof globalThis;
export {};

// v3 (BUG-004) : le logo a changé. Les icônes sont servies **cache-first** sous
// un nom de fichier inchangé — sans changer de nom de cache, un visiteur déjà
// venu continuerait de voir l'ancienne marque tant que son navigateur n'évince
// pas l'entrée, c'est-à-dire potentiellement jamais. Renommer le cache force
// `activate` à supprimer l'ancien et à reprécacher les nouveaux fichiers.
// v2 : le shell précache le manifest et les icônes (UF-601), le contenu de la
// v1 n'était plus représentatif de ce que la PWA attend hors-ligne.
const SHELL_CACHE = 'urbanflow-shell-v3';
// v2 : purge les caches d'assets constitués quand le worker tournait aussi en
// développement, où les chunks Next ne sont pas hashés (cf. ServiceWorkerRegister).
const ASSETS_CACHE = 'urbanflow-assets-v2';
const ROUTE_CACHE = 'urbanflow-last-route-v1';
const TILES_CACHE = 'urbanflow-map-tiles-v1';

/** Clé synthétique : l'API Cache ne stocke pas les requêtes POST directement. */
const LAST_ROUTE_KEY = '/__offline/last-route';

/**
 * Ressources de même origine précachées à l'installation : de quoi ouvrir
 * l'application installée sans réseau, manifest et icônes compris (C1).
 *
 * Précachées **une par une** et non par `addAll`, qui est atomique : un seul
 * 404 ferait échouer l'installation entière du worker et laisserait la PWA
 * sans aucun repli hors-ligne. Un asset manquant doit dégrader, pas casser.
 */
const PRECACHED_SHELL = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Le bloc marque et l'emblème sont rendus par la coque, donc par **toutes**
  // les pages : les précacher évite deux requêtes réseau au premier écran et
  // laisse la marque s'afficher hors-ligne (BUG-004, C1/C10).
  '/brand/logo-urbanflow.png',
  '/brand/logo-urbanflow-mark.png',
];

/**
 * Plafond du cache de fond de carte (éco-conception C5, et quota navigateur).
 *
 * ~250 tuiles ≈ la zone parcourue pendant une session de planification, à
 * plusieurs niveaux de zoom, pour quelques mégaoctets. Sans plafond, ce cache
 * grossit indéfiniment au fil des recherches et finit par se faire évincer
 * **en bloc** par le navigateur — on perdrait alors aussi le shell et le
 * dernier itinéraire, c'est-à-dire tout ce que ce ticket met en place.
 */
const MAX_TILES = 250;

/**
 * Hôtes de fond de carte connus : MapTiler et OpenStreetMap, les deux
 * fournisseurs que `lib/map-style.ts` sait résoudre.
 *
 * Sert pour les ressources qui ne sont **pas** des tuiles mais conditionnent
 * l'affichage (`style.json`, glyphes, sprites) : une carte vecteur privée de
 * ses glyphes hors-ligne s'affiche sans le moindre nom de rue.
 */
const MAP_ASSET_HOSTS = ['api.maptiler.com', 'tile.openstreetmap.org'];

/**
 * Chemin de tuile « slippy map » `…/{z}/{x}/{y}` — la convention commune aux
 * tuiles raster et vecteur, quel que soit le fournisseur (C9).
 *
 * Reconnaître la **forme** de l'URL plutôt qu'un hôte en dur couvre aussi un
 * fond auto-hébergé (`NEXT_PUBLIC_MAP_STYLE_URL`) sans recompiler le worker :
 * celui-ci est bundlé par esbuild et n'a pas accès aux variables
 * d'environnement inlinées par Next dans l'application.
 */
const TILE_PATH = /\/\d{1,2}\/\d{1,7}\/\d{1,7}(?:@\d+x)?(?:\.\w+)?$/;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  const expected = [SHELL_CACHE, ASSETS_CACHE, ROUTE_CACHE, TILES_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !expected.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;
  const url = new URL(request.url);

  // Dernier itinéraire calculé : network-first + repli cache (C10)
  if (request.method === 'POST' && url.pathname.endsWith('/routes/plan')) {
    event.respondWith(handlePlanRequest(request));
    return;
  }

  if (request.method !== 'GET') {
    return;
  }

  // Navigations : network-first, repli sur le shell en cache (C1)
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;

  // Assets statiques de build (hashés, immutables) : cache-first (C5)
  if (isSameOrigin && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, ASSETS_CACHE));
    return;
  }

  // Manifest et icônes : servis depuis le shell précaché quand le réseau manque (C1)
  if (isSameOrigin && PRECACHED_SHELL.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Fond de carte déjà consulté : cache-first borné (UF-601, C5/C10)
  if (!isSameOrigin && isMapAsset(url)) {
    event.respondWith(cacheFirstBounded(request));
  }
});

/** Précache le shell sans laisser un asset manquant faire échouer l'installation. */
async function precacheShell(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    PRECACHED_SHELL.map((path) =>
      cache.add(path).catch(() => {
        // Volontairement muet : l'app doit s'installer même sans cette ressource.
      }),
    ),
  );
}

/** Une URL tierce qui participe au fond de carte : tuile, style, glyphe ou sprite. */
function isMapAsset(url: URL): boolean {
  return MAP_ASSET_HOSTS.includes(url.hostname) || TILE_PATH.test(url.pathname);
}

/** POST /api/routes/plan : réseau d'abord, mémorise le succès, sert le dernier résultat hors-ligne. */
async function handlePlanRequest(request: Request): Promise<Response> {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(ROUTE_CACHE);
      await cache.put(LAST_ROUTE_KEY, response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(ROUTE_CACHE);
    const cached = await cache.match(LAST_ROUTE_KEY);
    if (cached) {
      // Signale à l'UI que le résultat provient du cache hors-ligne
      const headers = new Headers(cached.headers);
      headers.set('X-UrbanFlow-Cache', 'last-route');
      return new Response(cached.body, { status: 200, headers });
    }
    return new Response(
      JSON.stringify({ statusCode: 503, message: 'Hors-ligne et aucun itinéraire en cache' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/** Navigation : réseau d'abord (contenu frais), repli sur le shell en cache. */
async function handleNavigation(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (isCacheableShell(request, response)) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match('/');
    return (
      cached ??
      new Response('Hors-ligne — UrbanFlow nécessite une première visite en ligne.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

/**
 * Le shell hors-ligne ne doit être rafraîchi que par la vraie page d'accueil.
 *
 * Depuis UF-106, une navigation vers une page privée sans session est
 * **redirigée** vers `/login` par le middleware. Sans ce filtre :
 *  - le shell hors-ligne deviendrait l'écran de connexion (l'app installée
 *    s'ouvrirait sur « Connectez-vous » même pour un compte connecté) ;
 *  - une réponse redirigée finirait en cache, or un service worker n'a pas le
 *    droit de répondre à une navigation avec une réponse `redirected` — le
 *    navigateur rejette l'affichage.
 *
 * UF-801 rend `/` public, si bien qu'un visiteur n'y est plus redirigé : le
 * shell se remplit désormais dès la première visite, connectée ou non — l'app
 * installable l'est vraiment pour tout le monde (C1). Les deux garde-fous
 * restent en place : `redirected` reste interdit en cache quoi qu'il arrive, et
 * seul `/` a le droit de fournir le shell.
 */
function isCacheableShell(request: Request, response: Response): boolean {
  return response.ok && !response.redirected && new URL(request.url).pathname === '/';
}

/** Cache-first pour les ressources immutables de notre origine. */
async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * Cache-first borné, pour le fond de carte tiers (UF-601).
 *
 * Cache-first et non network-first : une tuile déjà vue ne change pas d'un
 * trajet à l'autre, et la resservir sans requête économise autant de données
 * que de batterie (C5). C'est aussi ce qui rend la carte lisible dans un tunnel
 * de métro — le cas d'usage même du produit.
 *
 * Les réponses **opaques** (fond raster OpenStreetMap, servi sans CORS) sont
 * mises en cache comme les autres : leur `status` vaut `0` et `ok` vaut donc
 * `false`, mais le navigateur sait les réafficher. Les filtrer sur
 * `response.ok` reviendrait à ne jamais rien cacher sur le fond de carte par
 * défaut du projet.
 */
async function cacheFirstBounded(request: Request): Promise<Response> {
  const cache = await caches.open(TILES_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
    await trimCache(cache, MAX_TILES);
  }
  return response;
}

/**
 * Ramène un cache à `maxEntries` en supprimant ses plus anciennes entrées.
 *
 * `cache.keys()` rend les requêtes dans leur ordre d'insertion : la première
 * est donc la plus anciennement mise en cache. Approximation assumée d'un LRU —
 * l'API Cache n'expose aucune date d'accès, et un vrai LRU demanderait un index
 * maison en IndexedDB pour un gain nul à cette échelle.
 */
async function trimCache(cache: Cache, maxEntries: number): Promise<void> {
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}
