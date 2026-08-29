import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Amorce de la suite d'audit d'accessibilité (UF-602) — ce que jsdom ne sait
 * pas faire et que les composants audités appellent quand même.
 *
 * Chaque bouchon posé ici est un **manque de jsdom**, jamais un contournement
 * d'un défaut du produit : si un composant avait besoin d'être neutralisé pour
 * passer axe, ce serait le composant qu'il faudrait corriger.
 */

// jsdom n'implémente pas `matchMedia`, que React et les composants qui lisent
// `prefers-reduced-motion` interrogent au montage.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

/**
 * Pose un bouchon global **seulement** s'il manque.
 *
 * Passe par un enregistrement indexé plutôt que par `window.X = …` : le
 * `if ('X' in window)` qu'appellerait la version directe réduit le type de
 * `window` à `never` dans la branche négative, et `next build` refuse alors de
 * compiler le fichier.
 */
function stubIfMissing(name: string, value: unknown) {
  const target = globalThis as unknown as Record<string, unknown>;
  target[name] ??= value;
}

// Pas d'observateur d'intersection ni de redimensionnement dans jsdom : le
// chargement différé de la carte (UF-201) et MapLibre s'en servent.
stubIfMissing(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

stubIfMissing(
  'IntersectionObserver',
  class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  },
);

// `fetch` n'est jamais l'objet de l'audit : les composants audités reçoivent
// leurs données en props ou via un mock explicite du test. Un rejet immédiat
// évite qu'un appel oublié parte vraiment sur le réseau depuis la CI (C5).
globalThis.fetch ??= vi.fn(() => Promise.reject(new Error('fetch non disponible dans les tests')));

// Démonter entre deux cas : axe analyse `document.body`, deux rendus laissés en
// place feraient remonter des doublons d'`id` qui n'existent pas dans l'app.
afterEach(() => {
  cleanup();
});
