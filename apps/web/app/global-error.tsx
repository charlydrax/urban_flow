'use client';

import { useEffect } from 'react';

import { ERROR_SCREEN, reportClientError } from '../lib/error-reporting';

/**
 * Dernier filet : erreur survenue dans le **layout racine** lui-même (UF-607).
 *
 * `app/error.tsx` ne couvre que les pages : il vit *sous* le layout, donc il ne
 * peut rien attraper de ce qui casse au-dessus de lui (en-tête, fournisseur de
 * session, polices). Ce composant-là remplace le document entier — d'où le
 * `<html>` et le `<body>` qu'il déclare, ce qu'aucun autre composant de
 * l'application ne fait.
 *
 * Il est volontairement autonome : ni en-tête, ni navigation, ni composant du
 * design system. Ce qui est cassé ici, c'est précisément la coquille commune ;
 * s'appuyer dessus reviendrait à risquer de planter dans l'écran de plantage.
 * Les styles sont donc en ligne, et le texte reste partagé avec `error.tsx`
 * pour que l'usager lise la même chose dans les deux cas.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Écran inconnu : la panne est antérieure au routage, on ne prétend pas
    // savoir sur quelle page elle est survenue.
    reportClientError(error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          padding: '2rem 1rem',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          color: '#14231c',
          background: '#ffffff',
        }}
      >
        <main role="alert" style={{ maxWidth: '38rem', margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>{ERROR_SCREEN.title}</h1>
          <p style={{ marginBottom: '1.5rem', lineHeight: 1.6 }}>{ERROR_SCREEN.message}</p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#0f7a43',
              color: '#ffffff',
              border: 0,
              borderRadius: '0.375rem',
              padding: '0.7rem 1.25rem',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            {ERROR_SCREEN.retry}
          </button>
          {error.digest !== undefined && (
            <p style={{ marginTop: '1.5rem', fontSize: '0.875rem', color: '#4b5a53' }}>
              {ERROR_SCREEN.referenceLabel} : <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
