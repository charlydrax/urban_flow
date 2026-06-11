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
      navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
        console.error('Service worker registration failed', error);
      });
    }
  }, []);

  return null;
}
