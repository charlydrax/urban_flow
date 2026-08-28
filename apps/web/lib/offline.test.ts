import { describe, expect, it } from 'vitest';

import {
  CACHE_SOURCE_HEADER,
  LAST_ROUTE_MARKER,
  OFFLINE_BANNER,
  isServedFromCache,
} from './offline';

/**
 * Recette UF-601 (C1/C10) — le contrat entre le service worker et la page.
 *
 * `sw.ts` n'est pas testé ici : il est compilé à part par esbuild et n'a de
 * sens que dans un `ServiceWorkerGlobalScope`. Ce qui doit rester vrai des deux
 * côtés, c'est le **nom de l'en-tête et sa valeur** — c'est cela qu'on fige.
 */

/** Minimal `Headers`-like, sans dépendre de l'implémentation du runtime. */
function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name] ?? null };
}

describe('isServedFromCache — provenance d’une réponse (UF-601)', () => {
  it('reconnaît le dernier itinéraire rejoué par le service worker', () => {
    expect(isServedFromCache(headers({ [CACHE_SOURCE_HEADER]: LAST_ROUTE_MARKER }))).toBe(true);
  });

  it('ne marque pas une réponse fraîche du réseau', () => {
    expect(isServedFromCache(headers({}))).toBe(false);
    expect(isServedFromCache(headers({ 'Content-Type': 'application/json' }))).toBe(false);
  });

  it('n’accepte pas une autre valeur de l’en-tête', () => {
    // Un futur marqueur (« shell », « tiles »…) ne doit pas être pris pour un
    // itinéraire rejoué : l'écran afficherait « recherche précédente » à tort.
    expect(isServedFromCache(headers({ [CACHE_SOURCE_HEADER]: 'shell' }))).toBe(false);
  });

  it('fige le nom de l’en-tête partagé avec sw.ts', () => {
    // Renommer d'un seul côté casserait silencieusement l'indicateur hors-ligne.
    expect(CACHE_SOURCE_HEADER).toBe('X-UrbanFlow-Cache');
    expect(LAST_ROUTE_MARKER).toBe('last-route');
  });
});

describe('OFFLINE_BANNER — texte de l’indicateur hors-ligne (C7/C11)', () => {
  it('ne divulgue aucun détail technique', () => {
    const text = `${OFFLINE_BANNER.label} ${OFFLINE_BANNER.message}`.toLowerCase();
    for (const jargon of ['service worker', 'cache', 'http', 'fetch', 'api', '503']) {
      expect(text, `« ${jargon} » ne doit pas apparaître`).not.toContain(jargon);
    }
  });

  it('dit ce qui reste possible, pas seulement ce qui est perdu', () => {
    expect(OFFLINE_BANNER.message).toMatch(/restent accessibles/);
  });
});
