'use client';

import { useEffect } from 'react';

/**
 * Enregistre le service worker de la PWA (C1) — en production uniquement.
 * Composant client sans rendu : l'enregistrement n'a lieu qu'au montage,
 * uniquement si le navigateur supporte les service workers (amélioration progressive).
 *
 * En développement, le worker est au contraire désenregistré et ses caches purgés :
 * sa stratégie cache-first sur `/_next/static/` (sûre en prod car les assets sont
 * hashés et immutables) servirait des chunks webpack périmés — en dev leurs noms
 * sont stables mais leur contenu change à chaque recompilation, ce qui casse le
 * runtime webpack (« Cannot read properties of undefined (reading 'call') »).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .then(() => caches.keys())
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => {
          // Nettoyage best-effort : ne doit jamais faire échouer le rendu en dev
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
