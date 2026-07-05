'use client';

import Link from 'next/link';
import { useState } from 'react';

const navLinks = [
  { href: '/', label: 'Itinéraires' },
  { href: '/', label: 'Mon impact CO₂' },
];

/**
 * En-tête et navigation principale — mobile-first (C2, UF-007).
 *
 * Sur mobile : bouton hamburger qui déplie le menu sous la barre ;
 * à partir de `md` : liens en ligne, bouton masqué.
 *
 * Accessibilité (C7) : `aria-expanded`/`aria-controls` sur le bouton,
 * libellé explicite pour lecteurs d'écran, zone tactile ≥ 44 px,
 * fermeture du menu à la navigation.
 */
export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="border-b border-ink-200 bg-white">
      <nav
        aria-label="Navigation principale"
        className="mx-auto max-w-5xl px-4 md:flex md:items-center md:justify-between md:gap-4"
      >
        <div className="flex items-center justify-between gap-4 py-3">
          <Link
            href="/"
            onClick={closeMenu}
            className="font-display text-lg font-bold text-primary-dark"
          >
            UrbanFlow <span className="font-normal">Mobility</span>
          </Link>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="menu-principal"
            onClick={() => setMenuOpen((open) => !open)}
            className="-mr-2 flex size-11 items-center justify-center rounded-md text-ink hover:bg-surface-muted md:hidden"
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
              {menuOpen ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>

        <ul
          id="menu-principal"
          className={`${menuOpen ? 'flex' : 'hidden'} flex-col gap-1 border-t border-ink-200 py-3 text-sm md:flex md:flex-row md:items-center md:gap-5 md:border-t-0 md:py-0`}
        >
          {navLinks.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                onClick={closeMenu}
                className="block rounded-md px-3 py-2 hover:bg-surface-muted md:px-1 md:py-1 md:underline-offset-4 md:hover:bg-transparent md:hover:underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li className="mt-1 md:mt-0">
            <Link
              href="/"
              onClick={closeMenu}
              className="block rounded-md bg-primary px-4 py-2 text-center font-bold text-white hover:bg-primary-dark"
            >
              Connexion
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
