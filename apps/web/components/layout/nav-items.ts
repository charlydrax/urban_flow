/**
 * Modèle de la navigation principale (UF-803) — planche Figma « 6. NAVIGATION »
 * (barre d'onglets basse) et « 03 · Maquettes desktop » (rail latéral sombre).
 *
 * Module **pur** : ni React, ni Next, ni DOM. C'est ce qui permet de tester les
 * deux seules règles qui comptent ici — *qui voit quoi* et *quel onglet est
 * actif* — dans la suite unitaire `node`, sans monter un rendu (C5 : jsdom coûte
 * ~1 s par fichier, cf. `vitest.config.ts`).
 *
 * ⚠️ Périmètre de confiance : `audience` dit qui a le droit de **voir** une
 * entrée, jamais qui a le droit d'ouvrir la page. L'autorité reste le middleware
 * (UF-106) et, derrière lui, le guard JWT de l'API (UF-104, C4). Retirer une
 * entrée d'ici n'a jamais protégé quoi que ce soit.
 */

/** Clé d'icône — résolue en SVG par `nav-icons.tsx`. Pas de composant ici (module pur). */
export type NavIconName = 'route' | 'leaf' | 'user' | 'signIn';

/**
 * À qui l'entrée s'adresse.
 *
 * - `all` : visible de tous — le planificateur, ouvert aux visiteurs (UF-801).
 * - `member` : réservée aux connectés. Proposer « Mon impact » à quelqu'un qui
 *   n'a pas de compte l'enverrait sur `/login` : ce n'est pas une navigation,
 *   c'est une impasse (raisonnement repris d'UF-801).
 * - `guest` : réservée aux visiteurs — la connexion, qui n'a plus de sens une
 *   fois connecté (le rail et `/profil` portent alors la déconnexion).
 */
export type NavAudience = 'all' | 'member' | 'guest';

/** Une entrée de la navigation principale, commune à la barre d'onglets et au rail. */
export interface NavItem {
  /** Route Next.js visée. */
  href: string;
  /**
   * Libellé unique, porté **tel quel** par les deux supports.
   *
   * La planche raccourcit les étiquettes de la barre d'onglets à un mot
   * (« Trajets », « Impact », « Profil ») là où le rail écrit la phrase
   * complète. Deux textes pour un même lien violeraient WCAG 2.5.3 (« Label in
   * Name ») : le nom visible doit être contenu dans le nom accessible, or
   * « Trajets » ne l'est pas dans « Planifier un trajet ». Avec au plus quatre
   * onglets, le libellé entier tient sous le picto — on garde donc un seul
   * texte, et la commande vocale « clique sur Itinéraires » fonctionne.
   */
  label: string;
  /** Icône de la planche, transcrite en SVG. */
  icon: NavIconName;
  /** Public visé — voir `NavAudience`. */
  audience: NavAudience;
}

/**
 * Entrées de la navigation, dans l'ordre de la planche.
 *
 * ## Pourquoi trois entrées et non les huit du rail dessiné
 *
 * Le rail de la planche liste « Tableau de bord », « Trajets sauvegardés »,
 * « Défis & récompenses », « Stations à proximité », « Signalements »… Ces
 * écrans n'existent pas : la fonctionnalité au choix retenue est l'**empreinte
 * carbone**, pas la gamification (CLAUDE.md §3), et le reste est hors périmètre
 * du prototype. Une entrée de navigation qui ne mène nulle part est un lien
 * mort ; on transcrit donc la **charte et l'agencement** de la planche, appliqués
 * aux trois écrans réellement livrés.
 *
 * Correspondance planche → application :
 *
 * | Planche (rail / onglet)              | Ici                  |
 * | ------------------------------------ | -------------------- |
 * | 🗺 Planifier un trajet / « Trajets » | `/` Itinéraires      |
 * | 🌱 Empreinte carbone / « Impact »    | `/impact`            |
 * | ⚙ Préférences / « Profil »          | `/profil`            |
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Itinéraires', icon: 'route', audience: 'all' },
  { href: '/impact', label: 'Mon impact', icon: 'leaf', audience: 'member' },
  { href: '/profil', label: 'Mon profil', icon: 'user', audience: 'member' },
  { href: '/login', label: 'Connexion', icon: 'signIn', audience: 'guest' },
];

/**
 * Filtre les entrées selon l'état de session — recette 2 et 4 du ticket UF-803.
 *
 * Rendre la **même liste** à la barre d'onglets et au rail est ce qui garantit
 * qu'un invité et un connecté voient une navigation cohérente d'un support à
 * l'autre : il n'y a qu'une source, elle ne peut pas diverger.
 *
 * @param signedIn `true` si une session est ouverte
 * @returns Les entrées visibles, dans l'ordre de la planche
 */
export function visibleNavItems(signedIn: boolean): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.audience === 'all' || item.audience === (signedIn ? 'member' : 'guest'),
  );
}

/**
 * Dit si une entrée correspond à la page courante (`aria-current="page"`, C7).
 *
 * La racine est comparée **à l'identique** : en préfixe, `/` marquerait
 * « Itinéraires » comme actif sur toutes les pages du site. Les autres acceptent
 * leurs sous-chemins, pour qu'un futur `/profil/securite` garde son onglet
 * allumé.
 *
 * @param pathname Chemin courant (`usePathname()`)
 * @param href Route de l'entrée
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
