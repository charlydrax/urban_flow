'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useSession } from '../../features/auth/session-provider';

const navLinks = [
  { href: '/', label: 'Itinéraires' },
  // Pointait sur `/` en attendant l'écran de suivi carbone, livré par UF-505.
  { href: '/impact', label: 'Mon impact CO₂' },
  { href: '/profil', label: 'Mon profil' },
];

/**
 * En-tête et navigation principale — mobile-first (C2, UF-007).
 *
 * Sur mobile **et tablette** : bouton hamburger qui déplie le menu sous la
 * barre ; à partir de `lg` (1024 px) : liens en ligne, bouton masqué.
 *
 * ## Pourquoi `lg` et non `md` (UF-606)
 *
 * Le passage en ligne se faisait à `md` (768 px), soit exactement la largeur
 * d'une tablette en portrait. À cette largeur, les six éléments — marque, trois
 * liens, adresse e-mail et bouton de déconnexion — ne tiennent pas : chacun se
 * cassait sur deux lignes (« Mon impact / CO₂ », « marie@urbanflow. / dev »), et
 * l'en-tête devenait un pavé de texte haché. Le menu replié, lui, reste lisible
 * et manipulable au doigt à cette taille. Le point de rupture suit donc ce que
 * le contenu exige, et non une taille d'écran symbolique.
 *
 * Les libellés sont en `whitespace-nowrap` et l'e-mail est tronqué : un compte
 * à l'adresse longue ne doit pas pouvoir reproduire ce pliage à 1024 px.
 *
 * Reflète l'**état de session** (UF-106) : compte connecté + bouton
 * « Déconnexion », ou lien « Connexion ». Les liens de navigation privés ne
 * sont affichés qu'aux utilisateurs connectés — inutile de proposer des liens
 * qui se solderaient par une redirection vers l'écran de connexion.
 *
 * Accessibilité (C7) : `aria-expanded`/`aria-controls` sur le bouton,
 * libellé explicite pour lecteurs d'écran, zone tactile ≥ 44 px,
 * fermeture du menu à la navigation.
 */
export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  const handleSignOut = async () => {
    closeMenu();
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="border-b border-ink-200 bg-white">
      <nav
        aria-label="Navigation principale"
        className="mx-auto max-w-7xl px-4 lg:flex lg:items-center lg:justify-between lg:gap-4"
      >
        <div className="flex items-center justify-between gap-4 py-3">
          <Link
            href="/"
            onClick={closeMenu}
            className="font-display text-lg font-bold whitespace-nowrap text-primary-dark"
          >
            UrbanFlow <span className="font-normal">Mobility</span>
          </Link>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="menu-principal"
            onClick={() => setMenuOpen((open) => !open)}
            className="-mr-2 flex size-11 items-center justify-center rounded-md text-ink hover:bg-surface-muted lg:hidden"
          >
            <span className="sr-only">{menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>

        <ul
          id="menu-principal"
          className={`${menuOpen ? 'flex' : 'hidden'} flex-col gap-1 border-t border-ink-200 py-3 text-sm lg:flex lg:flex-row lg:items-center lg:gap-5 lg:border-t-0 lg:py-0`}
        >
          {user &&
            navLinks.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  onClick={closeMenu}
                  className="block rounded-md px-3 py-2 whitespace-nowrap hover:bg-surface-muted lg:px-1 lg:py-1 lg:underline-offset-4 lg:hover:bg-transparent lg:hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}

          {user ? (
            <>
              {/* Identité du compte : confirme visuellement l'état connecté (C7). */}
              <li className="min-w-0 px-3 py-2 text-ink-700 lg:px-0 lg:py-0">
                <span className="sr-only">Connecté en tant que&nbsp;: </span>
                <span className="block max-w-64 truncate font-medium" title={user.email}>
                  {user.email}
                </span>
              </li>
              <li className="mt-1 lg:mt-0">
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="block w-full min-h-11 rounded-md border-2 border-primary px-4 py-2 text-center font-bold whitespace-nowrap text-primary-dark hover:bg-surface-muted disabled:opacity-60 lg:min-h-0"
                >
                  {signingOut ? 'Déconnexion…' : 'Déconnexion'}
                </button>
              </li>
            </>
          ) : (
            <li className="mt-1 lg:mt-0">
              <Link
                href="/login"
                onClick={closeMenu}
                className="block rounded-md bg-primary px-4 py-2 text-center font-bold whitespace-nowrap text-white hover:bg-primary-dark"
              >
                Connexion
              </Link>
            </li>
          )}
        </ul>
      </nav>
    </header>
  );
}
