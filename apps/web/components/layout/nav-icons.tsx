import type { JSX } from 'react';

import type { NavIconName } from './nav-items';

/**
 * Pictogrammes de la navigation principale (UF-803).
 *
 * ## Pourquoi des SVG et non les emoji de la planche
 *
 * La planche Figma pose des emoji (🗺 🌱 👤) — pratique pour une maquette HTML,
 * inutilisable en production pour trois raisons :
 *
 * 1. **Accessibilité (C7)** — un emoji est du *texte*. NVDA annonce « globe
 *    montrant l'Europe et l'Afrique » avant le libellé du lien : le nom
 *    accessible devient illisible. Un `<svg aria-hidden>` ne dit rien, et c'est
 *    exactement ce qu'on veut d'une icône doublée par son étiquette (WCAG 1.1.1).
 * 2. **Rendu** — le glyphe dépend de la police emoji du système : Segoe UI Emoji
 *    sur Windows, Noto sur Android, rien du tout sur certaines distributions.
 *    L'icône n'a alors ni la bonne taille, ni la bonne couleur (`currentColor`
 *    n'a aucun effet sur un emoji en couleur).
 * 3. **Éco-conception (C5)** — inline et monochromes, ces tracés ne coûtent ni
 *    requête, ni police supplémentaire.
 *
 * Chaque tracé transcrit la métaphore de la planche, pas son glyphe : carte
 * pliée pour les itinéraires, feuille pour l'impact carbone, buste pour le
 * profil, flèche entrante pour la connexion.
 *
 * Les attributs communs (taille, `stroke="currentColor"`, `aria-hidden`) sont
 * portés par `NavIcon` : l'icône hérite donc de la couleur de son lien, et
 * s'allume avec lui à l'état actif sans règle supplémentaire.
 */
const paths: Record<NavIconName, JSX.Element> = {
  /** Carte pliée + tracé — « 🗺 Planifier un trajet » de la planche. */
  route: (
    <>
      <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z" />
      <path d="M9 4v13M15 6.5v13" />
    </>
  ),
  /** Feuille — « 🌱 Empreinte carbone ». */
  leaf: (
    <>
      <path d="M4.5 19.5C3 16 3.5 9.5 8 6.5c3.2-2.1 8-2 11.5-2 .5 4 .3 9-2.2 12-3 3.6-9.3 4.4-12.8 3Z" />
      <path d="M4.5 19.5C7 15 11 11.5 16 9.5" />
    </>
  ),
  /** Buste — « 👤 Profil ». */
  user: (
    <>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  /** Flèche entrant dans une porte — « Connexion » (entrées invité). */
  signIn: (
    <>
      <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8.5 13.5 12 10 15.5M13 12H4" />
    </>
  ),
};

/**
 * Rend le pictogramme d'une entrée de navigation.
 *
 * Purement **décoratif** (`aria-hidden`) : le libellé du lien porte déjà le sens
 * (C7 — WCAG 1.1.1). Hérite de `currentColor`, donc de l'état actif du lien.
 *
 * @param name Clé d'icône de `NavItem.icon`
 * @param className Classes de taille (la barre d'onglets et le rail n'ont pas la même)
 */
export function NavIcon({ name, className = '' }: { name: NavIconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
