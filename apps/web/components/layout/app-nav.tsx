'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { useSession } from '../../features/auth/session-provider';
import { initialsFromEmail } from '../../lib/initials';
import { NavIcon } from './nav-icons';
import { isNavItemActive, visibleNavItems } from './nav-items';

/**
 * Navigation principale de la PWA (UF-803) — **un seul composant pour les deux
 * formes** de la planche Figma : barre d'onglets basse sur mobile, rail latéral
 * sombre à partir de `lg` (1024 px).
 *
 * Remplace l'en-tête haut à trois liens et son menu hamburger (UF-007/UF-606),
 * supprimés par ce ticket.
 *
 * ## Pourquoi un seul élément qui se métamorphose, et non deux composants
 *
 * La tentation était de livrer une `<TabBar>` et un `<DesktopRail>` montés tous
 * les deux, l'un masqué par média-requête. C'était deux `<nav>` dans le
 * document, donc **deux repères de navigation portant le même nom** : axe le
 * signale (`landmark-unique`), un lecteur d'écran annonce deux fois « navigation
 * principale » sans les distinguer, et surtout les entrées auraient pu diverger
 * d'un support à l'autre — exactement ce que la recette 4 du ticket interdit.
 *
 * Un seul conteneur, une seule liste, deux habillages en variantes `lg:` : la
 * cohérence invité/connecté n'est alors plus une consigne, c'est une propriété
 * du code. Le HTML rendu est aussi plus léger (C5).
 *
 * ## Transcription de la planche
 *
 * | Élément            | Planche (`design/UrbanFlow_Maquettes_Lyon_v2.html`)       | Ici                              |
 * | ------------------ | --------------------------------------------------------- | -------------------------------- |
 * | Barre d'onglets    | `#fff`, filet Ink 200 en haut, picto au-dessus du libellé | idem                             |
 * | Onglet au repos    | Ink 500                                                    | idem                             |
 * | Onglet actif       | Vert 700, gras                                             | idem                             |
 * | Rail desktop       | 230 px, fond Ink 900, texte `#C9D2E2`                     | idem (`bg-ink`, `text-rail-ink`) |
 * | Entrée active rail | pastille Vert 500, texte blanc, rayon 8 px                | **Vert 700** — voir ci-dessous   |
 * | Bloc compte        | pastille d'initiales + identité, filet haut translucide    | idem, + bouton de déconnexion    |
 *
 * **Écart assumé (C7).** La planche pose du blanc sur Vert 500 (`#1FA85C`) pour
 * l'entrée active du rail : 3.08:1, sous le seuil AA de 4.5:1 exigé pour un
 * texte de 13,5 px. La charte elle-même annote Vert 500 « 4.6:1 sur blanc »,
 * c'est-à-dire comme *texte sur fond clair* — pas comme fond d'un texte blanc.
 * On garde donc la pastille verte, en Vert 700 (`#0E7A3F`) : 5.42:1 pour le
 * texte, et 3.38:1 entre la pastille et le rail, soit le seuil non textuel
 * (WCAG 1.4.11). Ratios vérifiés par `lib/design-tokens.test.ts`.
 *
 * ## Accessibilité (C7)
 *
 * - Un unique repère `navigation` nommé (WCAG 1.3.1, 2.4.1).
 * - `aria-current="page"` sur l'entrée courante : l'état actif ne repose pas sur
 *   la seule couleur (WCAG 1.4.1). Le gras le double visuellement.
 * - Cibles tactiles ≥ 44 px sur la barre d'onglets (WCAG 2.5.5).
 * - Le libellé est toujours écrit, jamais réduit à un picto : les icônes sont
 *   `aria-hidden` (WCAG 1.1.1, cf. `nav-icons.tsx`).
 * - Plus de menu à déplier : c'était le seul mécanisme de l'ancien en-tête qui
 *   demandait `aria-expanded` — il disparaît avec lui.
 *
 * ## État de session (F1, UF-106/UF-801)
 *
 * Les entrées privées ne sont **pas rendues** à un visiteur (`nav-items.ts`), et
 * le bloc de compte du rail bascule en invitation à créer un compte. Rien ici
 * n'est une protection : le middleware et le guard JWT de l'API restent
 * l'autorité (C4).
 */
export function AppNav() {
  const pathname = usePathname();
  const { user } = useSession();
  const items = visibleNavItems(Boolean(user));

  return (
    /*
      Mobile : barre fixe en bas de l'écran, hors du flux — elle doit rester
      atteignable au pouce quel que soit le défilement. `env(safe-area-inset-bottom)`
      la relève au-dessus de la barre de gestes iOS, sans quoi le dernier onglet
      est à moitié inatteignable sur un iPhone récent.

      Desktop : le même bloc devient le rail de 230 px de la planche, collant en
      haut sur toute la hauteur de la fenêtre (`sticky` + `h-dvh`), donc visible
      pendant qu'une longue page défile à côté. `inset-x-auto` / `bottom-auto`
      annulent les décalages du mode fixe, que `sticky` interpréterait comme des
      seuils d'adhérence.
    */
    <div
      className={
        'fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white pb-[env(safe-area-inset-bottom)] ' +
        'lg:sticky lg:inset-x-auto lg:top-0 lg:bottom-auto lg:z-auto lg:flex lg:h-dvh lg:w-[230px] ' +
        'lg:shrink-0 lg:flex-col lg:border-t-0 lg:bg-ink lg:px-3 lg:py-5'
      }
    >
      {/*
        Bloc marque du rail. Masqué sur mobile, où la même marque est portée par
        la barre fine du haut (`MobileBrandBar`) : la répéter dans la barre
        d'onglets coûterait une colonne pour un élément qui n'est pas une
        destination. Le monogramme est décoratif — le mot « UrbanFlow » qui suit
        est déjà le nom accessible du lien (C7, WCAG 1.1.1).
      */}
      <Link
        href="/"
        className="mb-6 hidden items-center gap-2 rounded-md px-1.5 font-display text-[17px] font-extrabold text-white lg:flex"
      >
        <span
          aria-hidden="true"
          className="flex size-[26px] items-center justify-center rounded-[7px] bg-primary text-[13px] text-white"
        >
          U
        </span>
        UrbanFlow
      </Link>

      <nav aria-label="Navigation principale">
        <ul className="flex items-stretch justify-around lg:flex-col lg:gap-[3px]">
          {items.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <li key={item.href} className="lg:w-full">
                <Link
                  href={item.href}
                  // Doublé par le gras et la pastille : l'information ne passe
                  // pas que par la couleur (C7 — WCAG 1.4.1).
                  aria-current={active ? 'page' : undefined}
                  className={
                    // Mobile : picto au-dessus du libellé, colonne d'au moins
                    // 44 px de haut (WCAG 2.5.5). Desktop : ligne picto + texte.
                    'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-[11px] ' +
                    'lg:min-h-0 lg:flex-row lg:justify-start lg:gap-2.5 lg:px-2.5 lg:py-2.5 lg:text-[13.5px] ' +
                    (active
                      ? 'font-bold text-primary-dark lg:bg-primary-dark lg:text-white'
                      : 'text-ink-500 hover:bg-surface-muted lg:text-rail-ink lg:hover:bg-white/10 lg:hover:text-white')
                  }
                >
                  <NavIcon name={item.icon} className="size-6 lg:size-[18px]" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <RailAccountBlock />
    </div>
  );
}

/**
 * Pied du rail desktop — bloc `.user` de la planche (pastille d'initiales,
 * identité, filet haut translucide), poussé en bas par `mt-auto`.
 *
 * Masqué sous `lg` : sur mobile, l'identité et la déconnexion vivent dans
 * `/profil` (carte de compte d'UF-107), qui est à un onglet de distance. Les
 * loger aussi dans la barre d'onglets coûterait une colonne pour dupliquer un
 * écran existant.
 *
 * Pour un **visiteur**, le bloc n'est pas vide : il porte l'invitation à créer
 * un compte. La connexion, elle, est déjà une entrée de navigation à part
 * entière (`nav-items.ts`) — la répéter ici ferait deux boutons pour une action.
 */
function RailAccountBlock() {
  const { user, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  if (!user) {
    return (
      <div className="mt-auto hidden border-t border-white/10 px-1.5 pt-3 lg:block">
        <p className="text-[12px] text-rail-ink">
          Pas encore de compte&nbsp;?{' '}
          <Link href="/register" className="font-bold text-white underline underline-offset-4">
            Créer un compte
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mt-auto hidden border-t border-white/10 px-1.5 pt-3 lg:block">
      <div className="flex items-center gap-2.5">
        {/* Initiales décoratives : l'adresse e-mail qui suit les redit (C7). */}
        <span
          aria-hidden="true"
          className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-extrabold text-white"
        >
          {initialsFromEmail(user.email)}
        </span>
        <span className="min-w-0 text-[12px] text-white">
          <span className="sr-only">Connecté en tant que&nbsp;: </span>
          <span className="block truncate font-bold" title={user.email}>
            {user.email}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="mt-2 min-h-11 w-full rounded-md border border-white/25 px-3 py-2 text-[12px] font-bold text-white hover:bg-white/10 disabled:opacity-60"
      >
        {signingOut ? 'Déconnexion…' : 'Déconnexion'}
      </button>
    </div>
  );
}
