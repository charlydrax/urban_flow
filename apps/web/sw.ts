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
 */

declare const self: ServiceWorkerGlobalScope & typeof globalThis;
export {};

const SHELL_CACHE = 'urbanflow-shell-v1';
const ASSETS_CACHE = 'urbanflow-assets-v1';
const ROUTE_CACHE = 'urbanflow-last-route-v1';

/** Clé synthétique : l'API Cache ne stocke pas les requêtes POST directement. */
const LAST_ROUTE_KEY = '/__offline/last-route';

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(['/']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  const expected = [SHELL_CACHE, ASSETS_CACHE, ROUTE_CACHE];
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

  // Assets statiques de build (hashés, immutables) : cache-first (C5)
  if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
  }
});

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
 * Depuis UF-106, une navigation vers `/` sans session est **redirigée** vers
 * `/login` par le middleware. Sans ce filtre :
 *  - le shell hors-ligne deviendrait l'écran de connexion (l'app installée
 *    s'ouvrirait sur « Connectez-vous » même pour un compte connecté) ;
 *  - une réponse redirigée finirait en cache, or un service worker n'a pas le
 *    droit de répondre à une navigation avec une réponse `redirected` — le
 *    navigateur rejette l'affichage.
 */
function isCacheableShell(request: Request, response: Response): boolean {
  return response.ok && !response.redirected && new URL(request.url).pathname === '/';
}

/** Cache-first pour les assets immutables. */
async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSETS_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}
