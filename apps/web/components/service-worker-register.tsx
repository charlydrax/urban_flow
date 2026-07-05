'use client';

import { useEffect } from 'react';

/**
 * Enregistre le service worker de la PWA (C1).
 * Composant client sans rendu : l'enregistrement n'a lieu qu'au montage,
 * uniquement si le navigateur supporte les service workers (amélioration progressive).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // updateViaCache: 'none' — sw.js n'est jamais servi depuis le cache HTTP,
      // les nouvelles versions du worker sont détectées dès la visite suivante (C1)
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .catch((error: unknown) => {
          console.error('Service worker registration failed', error);
        });
    }
  }, []);

  return null;
}
