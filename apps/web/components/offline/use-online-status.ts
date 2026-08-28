'use client';

import { useSyncExternalStore } from 'react';

/**
 * Abonne le composant aux transitions de connectivité du navigateur (UF-601).
 *
 * Les événements `online` / `offline` sont posés sur `window` et non sur
 * `navigator` : c'est `window` qui les diffuse, `navigator.onLine` n'étant que
 * la valeur courante.
 */
function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);
  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

/** Valeur courante, côté navigateur uniquement. */
function getSnapshot(): boolean {
  return navigator.onLine;
}

/**
 * Valeur supposée au rendu serveur : **connecté**.
 *
 * Le serveur n'a évidemment aucun moyen de connaître l'état réseau du client.
 * Supposer « connecté » garantit que le HTML envoyé ne contient jamais le
 * bandeau hors-ligne : s'il y figurait, une page servie depuis le cache du
 * service worker l'afficherait à quelqu'un dont la connexion est revenue,
 * jusqu'à l'hydratation.
 */
function getServerSnapshot(): boolean {
  return true;
}

/**
 * État de la connexion réseau, réactif (UF-601 — C10).
 *
 * ## Pourquoi `useSyncExternalStore` et pas `useState` + `useEffect`
 *
 * `navigator.onLine` est une source extérieure à React, qui change sans que
 * React en soit averti. Le couple `useState`/`useEffect` lirait la valeur
 * **après** le premier rendu : une coupure survenue entre le rendu serveur et
 * l'hydratation passerait inaperçue jusqu'au prochain événement, c'est-à-dire
 * jusqu'au retour du réseau. `useSyncExternalStore` sépare explicitement
 * l'instantané serveur de l'instantané client et interdit ce décalage.
 *
 * ## Ce que cette valeur vaut vraiment
 *
 * `navigator.onLine` répond à « l'appareil a-t-il une interface réseau
 * active ? », pas à « Internet répond-il ? ». Un Wi-Fi de gare capté sans accès
 * réel se déclare en ligne. C'est pour cela que l'indicateur de bandeau est un
 * **complément** et non le seul filet : la vérité sur l'accessibilité de l'API
 * reste l'échec de la requête, traité par `classifyPlanFailure`, et la
 * provenance réelle des résultats est dite par l'en-tête du service worker.
 *
 * @returns `true` tant que le navigateur se déclare connecté
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
