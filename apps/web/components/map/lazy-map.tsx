'use client';

import dynamic from 'next/dynamic';

import type { MapViewProps } from './map-view';

/**
 * Chargement différé et **strictement client** de `MapView` (`ssr: false`).
 *
 * Deux raisons :
 * - **technique** : MapLibre manipule `window`/WebGL dès l'import — un rendu
 *   serveur échouerait sur `window is not defined` ;
 * - **éco-conception (C5) / performance (C10)** : le bundle MapLibre
 *   (~250 Ko gzip) sort du bundle initial et n'est téléchargé que sur les
 *   écrans qui affichent réellement une carte.
 */
const MapViewLazy = dynamic(() => import('./map-view').then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full w-full items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-500"
    >
      <p>Chargement de la carte…</p>
    </div>
  ),
});

/**
 * Point d'entrée à utiliser dans les pages — même API que `MapView`.
 *
 * La hauteur est portée par cette enveloppe (et non par le composant chargé) :
 * l'espace est ainsi réservé **avant** l'arrivée de MapLibre, ce qui évite tout
 * décalage de mise en page pendant le chargement (C2, Cumulative Layout Shift).
 *
 * @param className Classes de dimensionnement — défaut : hauteur de la maquette
 * (420 px en mobile, 560 px à partir du point de rupture desktop).
 */
export function LazyMap({ className = 'h-[420px] md:h-[560px]', ...props }: MapViewProps) {
  return (
    <div className={className}>
      <MapViewLazy className="h-full w-full" {...props} />
    </div>
  );
}
