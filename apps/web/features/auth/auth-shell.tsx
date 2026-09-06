import Link from 'next/link';
import type { ReactNode } from 'react';

import { BrandLockup } from '../../components/brand/brand-logo';

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
 *
 * BUG-004 : le bloc marque coiffe désormais la carte. Sur ces deux écrans la
 * coque est réduite au minimum — pas de rail desktop, une barre mobile discrète
 * — et rien ne disait à qui l'on confie son mot de passe. Le logo y est
 * **décoratif** (`alt=""`) : le titre `<h1>` de la page et l'onglet du
 * navigateur portent déjà le nom du service, et un lecteur d'écran l'annoncerait
 * sinon deux fois avant d'atteindre le formulaire (C7, WCAG 1.1.1).
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
      {/* `rounded-xl` : le fichier a un fond blanc opaque, plus clair que le
          fond de page (`surface`, #f6f8fb). Sans angles arrondis, on verrait un
          rectangle blanc posé là ; arrondi au même rayon que la carte du
          formulaire, il se lit comme un élément de la même composition. */}
      <BrandLockup alt="" className="mx-auto mb-5 w-[176px] rounded-xl" />

      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card sm:p-7">
        <h1 id={titleId} className="font-display text-2xl leading-9 font-extrabold text-ink">
          {title}
        </h1>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-ink-500">{subtitle}</p>

        {children}

        <p className="mt-6 text-center text-xs text-ink-500">
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
