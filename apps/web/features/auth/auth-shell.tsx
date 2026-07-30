import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '../../components/ui/button';

export interface AuthShellProps {
  /** `id` du titre — repris en `aria-labelledby` par le formulaire enfant (C7). */
  titleId: string;
  /** Titre de l'écran, façon maquette (« Bon retour 👋 »). */
  title: ReactNode;
  /** Accroche affichée sous le titre. */
  subtitle: string;
  /** Formulaire de l'écran (composant client). */
  children: ReactNode;
  /** Bascule vers l'autre écran d'auth, en bas de carte. */
  switchPrompt: string;
  switchHref: string;
  switchLabel: string;
}

/**
 * Habillage commun aux écrans de connexion et d'inscription (F1), transposé de
 * la maquette Figma « 02 · Maquettes mobile — 2. CONNEXION F1 ».
 *
 * La maquette représente l'écran dans un châssis de téléphone 375 × 812 ; en
 * PWA on rend le *contenu* de cet écran : pleine largeur sur mobile, puis carte
 * centrée à 400 px max dès `sm` (C2 — mobile-first, utilisable sur tout support).
 *
 * Volontairement **Server Component** : seuls les formulaires sont interactifs,
 * ce qui garde le JS envoyé au client au minimum (C5 éco-conception, C10 perfs).
 */
export function AuthShell({
  titleId,
  title,
  subtitle,
  children,
  switchPrompt,
  switchHref,
  switchLabel,
}: AuthShellProps) {
  return (
    <div className="mx-auto w-full max-w-[400px]">
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-7">
        <h1 id={titleId} className="font-display text-2xl leading-9 font-extrabold text-ink">
          {title}
        </h1>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-ink-500">{subtitle}</p>

        {children}

        {/*
         * Bloc « ou continuer avec » de la maquette. La fédération d'identité
         * n'est pas au périmètre du prototype (UF-102/103 : email + mot de passe
         * uniquement) : le bouton est présent pour la fidélité visuelle mais
         * explicitement désactivé et annoncé comme tel, plutôt que de simuler une
         * action inexistante.
         */}
        <div className="mt-4 flex items-center gap-3">
          <span aria-hidden="true" className="h-px flex-1 bg-ink-200" />
          {/* Ink 500 au lieu du gris de la maquette : contraste AA sur blanc (C7). */}
          <span className="text-[11px] text-ink-500">ou continuer avec</span>
          <span aria-hidden="true" className="h-px flex-1 bg-ink-200" />
        </div>

        <Button
          variant="neutral"
          className="mt-4 w-full"
          disabled
          aria-describedby={`${titleId}-soon`}
        >
          G · Google
        </Button>
        <p id={`${titleId}-soon`} className="sr-only">
          Fonctionnalité prévue après le prototype.
        </p>

        <p className="mt-4 text-center text-xs text-ink-500">
          {switchPrompt}{' '}
          <Link
            href={switchHref}
            className="font-bold text-primary-dark underline underline-offset-4"
          >
            {switchLabel}
          </Link>
        </p>
      </div>
    </div>
  );
}
