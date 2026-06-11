'use client';

import dynamic from 'next/dynamic';

/**
 * Wrapper de chargement différé de la carte (C5 — éco-conception).
 *
 * MapLibre GL JS (~250 Ko gzip) n'est téléchargé que côté client et seulement
 * quand le composant entre dans l'arbre : il est exclu du bundle initial
 * (`ssr: false`) — réduit le poids de la première visite (C10).
 * Le placeholder réserve l'espace (pas de décalage de mise en page — C2).
 */
export const LazyMap = dynamic(() => import('./map-view').then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-live="polite"
      className="flex h-[420px] items-center justify-center rounded-lg border border-primary/20 bg-white"
    >
      <p>Chargement de la carte…</p>
    </div>
  ),
});
