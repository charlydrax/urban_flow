'use client';

import { useEffect } from 'react';

/**
 * Désinstalle le service worker et purge ses caches (développement uniquement).
 *
 * Un worker déjà installé survit à la suppression du code qui l'enregistrait :
 * sans ce nettoyage, les postes de dev dont le cache est déjà pollué
 * continueraient d'exécuter l'ancien bundle indéfiniment.
 */
async function unregisterInDev(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (!('caches' in window)) return;
  // Tous les caches du worker, quelle que soit leur version (cf. `sw.ts`).
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name.startsWith('urbanflow-')).map((n) => caches.delete(n)),
  );
}

/**
 * Enregistre le service worker de la PWA (C1).
 * Composant client sans rendu : l'enregistrement n'a lieu qu'au montage,
 * uniquement si le navigateur supporte les service workers (amélioration progressive).
 *
 * **En développement, le worker est désinstallé au lieu d'être enregistré.**
 * Sa stratégie « cache-first » sur `/_next/static/` suppose des URLs immuables :
 * c'est vrai en production (Next hashe chaque chunk), mais faux avec
 * `next dev`, où le chemin d'un chunk (`/_next/static/chunks/app/profil/page.js`)
 * ne change jamais d'une compilation à l'autre. Le premier exemplaire mis en
 * cache était alors servi pour toujours : le navigateur exécutait un bundle
 * périmé, insensible aux modifications du code comme au rechargement forcé.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void unregisterInDev().catch((error: unknown) => {
        console.error('Service worker cleanup failed', error);
      });
      return;
    }

    // updateViaCache: 'none' — sw.js n'est jamais servi depuis le cache HTTP,
    // les nouvelles versions du worker sont détectées dès la visite suivante (C1)
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch((error: unknown) => {
        console.error('Service worker registration failed', error);
      });
  }, []);

  return null;
}
