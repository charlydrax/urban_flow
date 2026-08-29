'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { Button } from '../components/ui/button';
import { ERROR_SCREEN, getLastApiRequestId, reportClientError } from '../lib/error-reporting';

/**
 * Frontière d'erreur des pages de la PWA (UF-607).
 *
 * Next.js monte ce composant à la place de la page dès qu'un rendu lève. Sans
 * lui, l'usager reçoit l'écran d'erreur générique du framework — sans mise en
 * page, sans issue, et surtout sans que personne ne sache que c'est arrivé.
 *
 * Deux rôles, donc, et le second compte autant que le premier :
 *  1. **rendre la main** à l'usager (réessayer, revenir à la planification) ;
 *  2. **signaler** la panne à l'API, avec la référence qu'il pourra recopier.
 *
 * Accessibilité (C7) : l'erreur est annoncée par une région `role="alert"`
 * (WCAG 4.1.3), et la page conserve un titre de niveau 1 pour ne pas casser la
 * hiérarchie de titres. La référence technique est présentée dans un bloc
 * `code` sélectionnable — pas dans un message qu'il faudrait retranscrire.
 */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    // Dans l'effet, et non pendant le rendu : un rendu doit rester sans effet
    // de bord, et React peut le rejouer (StrictMode) — le signalement partirait
    // deux fois.
    reportClientError(error, pathname);
  }, [error, pathname]);

  // Le `digest` de Next.js désigne une erreur survenue au rendu serveur ;
  // l'identifiant d'appel désigne la dernière requête d'API. L'un ou l'autre
  // suffit à retrouver la trace côté serveur (docs/bug-process.md).
  const reference = error.digest ?? getLastApiRequestId();

  return (
    <div className="mx-auto max-w-prose py-8" role="alert">
      <h1 className="mb-3 font-display text-2xl font-bold text-primary-dark">
        {ERROR_SCREEN.title}
      </h1>
      <p className="mb-6 text-ink">{ERROR_SCREEN.message}</p>

      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>{ERROR_SCREEN.retry}</Button>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-md border-2 border-primary bg-white px-5 py-[11px] text-sm font-bold text-primary-dark transition-colors hover:bg-tint-green"
        >
          {ERROR_SCREEN.home}
        </Link>
      </div>

      {reference !== undefined && (
        <p className="mt-6 text-sm text-ink-500">
          {ERROR_SCREEN.referenceLabel} :{' '}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-ink">
            {reference}
          </code>
        </p>
      )}
    </div>
  );
}
