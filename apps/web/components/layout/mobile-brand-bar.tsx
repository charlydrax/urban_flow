import Link from 'next/link';

import { BrandMark } from '../brand/brand-logo';

/**
 * Barre de marque du haut, **mobile uniquement** (UF-803).
 *
 * Ce n'est pas la survivance de l'ancien en-tête : elle ne porte aucun lien de
 * navigation — ils sont tous descendus dans la barre d'onglets. Elle rend
 * simplement, sur petit écran, le service que le bloc marque du rail rend sur
 * grand : dire où l'on est, et offrir un retour à l'accueil d'un geste. Les
 * écrans téléphone de la planche affichent une barre fine de même facture
 * (titre d'écran à gauche) sous la barre d'état du système.
 *
 * ## Pourquoi un fichier séparé d'`app-nav.tsx` (C5)
 *
 * Elle n'a ni état, ni gestionnaire d'événement, ni lecture de session : rien
 * n'appelle un `'use client'`. Laissée dans le module de `AppNav`, elle héritait
 * de sa directive et partait dans le lot JavaScript de **toutes** les pages pour
 * y refaire, à l'exécution, un balisage strictement statique. Isolée, elle reste
 * un Server Component : le HTML est rendu une fois côté serveur et rien n'est
 * envoyé au navigateur.
 *
 * Accessibilité (C7) : l'emblème est décoratif (`alt=""`), le nom accessible du
 * lien vient du texte « UrbanFlow Mobility » qui le suit.
 *
 * BUG-004 : le monogramme « U » provisoire a laissé place à l'emblème du logo
 * officiel. C'est bien `BrandMark` et non `BrandLockup` qui est employé ici —
 * la barre fait 40 px de haut, où le mot-symbole du bloc complet serait
 * illisible, et le nom de la marque est de toute façon écrit à côté.
 */
export function MobileBrandBar() {
  return (
    <header className="border-b border-ink-200 bg-white lg:hidden">
      <Link
        href="/"
        className="flex items-center gap-2 px-4 py-2 font-display text-base font-extrabold text-primary-dark"
      >
        <BrandMark alt="" className="h-7 w-auto" />
        UrbanFlow <span className="font-normal">Mobility</span>
      </Link>
    </header>
  );
}
