import {
  MAX_TRAVELLERS,
  MIN_TRAVELLERS,
  TransportMode,
  type AppliedRouteConstraints,
  type ItinerarySortKey,
  type PlanRouteRequest,
} from '@urbanflow/shared';

import { MODE_ICONS } from './itinerary-cards';
import { MODE_TRACK_STYLES } from './route-map-layers';

/**
 * Modèle des **options de recherche** du planificateur (UF-804) — chips heure et
 * voyageurs, sélecteur de modes, bandeau « mode éco ».
 *
 * Module **pur** : ni React, ni `fetch`, ni horloge implicite. Tout ce qui
 * dépend du temps la reçoit en argument, ce qui rend l'ensemble testable dans
 * l'environnement `node` de Vitest — même stratégie que `itinerary-cards.ts`
 * (UF-404) et `route-map-layers.ts` (UF-403).
 *
 * ## Ce que le module décide, et ce qu'il refuse de décider
 *
 * Il **traduit** un état d'écran en corps de requête, et rien de plus. Il ne
 * choisit pas les itinéraires, ne les trie pas, et n'anticipe pas ce que le
 * serveur en fera : `toPlanOptions` produit un objet dont chaque champ absent
 * signifie « laisse le défaut du serveur s'appliquer ». C'est ce qui garantit
 * qu'un écran auquel on n'a pas touché envoie exactement la requête d'avant
 * UF-804 — et donc que le ticket n'a rien changé pour qui ne s'en sert pas.
 *
 * Couvre : C9 (le corps produit implémente `PlanRouteRequest`), C7 (chaque
 * option porte son libellé écrit, jamais une couleur seule), C5 (aucune
 * dépendance, aucune bibliothèque de dates).
 */

/** Départ « maintenant » — le défaut de la chip, et de très loin le cas courant. */
export const DEPART_NOW = 'now';

/**
 * État des options de recherche, tel que le formulaire le tient.
 *
 * `departAt` est une chaîne `datetime-local` (`AAAA-MM-JJTHH:MM`, **sans**
 * fuseau) ou {@link DEPART_NOW}. On garde la forme du champ HTML jusqu'au
 * dernier moment : la convertir en ISO à chaque frappe obligerait à la
 * reconvertir pour réafficher le champ, et deux conversions inverses finissent
 * toujours par diverger d'une minute ou d'une heure d'été.
 */
export interface TripOptions {
  departAt: string;
  travellers: number;
  /** Modes cochés. Tous cochés = aucune restriction (voir {@link toPlanOptions}). */
  modes: TransportMode[];
}

/**
 * Modes offerts au sélecteur, dans l'ordre de la planche Figma
 * (« 4. PLANIFICATEUR F2 » : Vélo'v, Bus, Métro, Tram, Trott., Marche).
 *
 * Le covoiturage n'y figure pas, et c'est volontaire : aucune source ne le
 * fournit (`CLAUDE.md` §3 — F3 couvre GTFS et GBFS), donc aucun itinéraire ne
 * peut en porter. Une case qui ne changerait jamais rien serait pire qu'absente
 * — elle laisserait croire qu'on a cherché des covoiturages.
 */
export const SELECTABLE_MODES: readonly TransportMode[] = [
  TransportMode.BIKE,
  TransportMode.BUS,
  TransportMode.METRO,
  TransportMode.TRAM,
  TransportMode.SCOOTER,
  TransportMode.WALK,
];

/** Une case du sélecteur de modes : ce que la tuile a besoin de peindre. */
export interface ModeChoice {
  mode: TransportMode;
  /** Libellé écrit — porte l'information, l'icône ne fait que l'illustrer (C7). */
  label: string;
  /** Pictogramme décoratif, à poser en `aria-hidden`. */
  icon: string;
  /** Couleur du mode, **la même** que celle de son tracé sur la carte. */
  color: string;
}

/**
 * Catalogue du sélecteur de modes.
 *
 * Le libellé et la couleur viennent de `MODE_TRACK_STYLES`, source unique du
 * vocabulaire des modes côté client : une tuile « Vélo » verte et un tracé vélo
 * d'un autre vert rompraient le lien que l'écran cherche justement à établir.
 * La planche écrit « Vélo'v », nom de l'opérateur ; on garde « Vélo », le nom du
 * mode — le jour où une seconde flotte arrivera, la tuile n'aura pas à mentir.
 */
export const MODE_CHOICES: readonly ModeChoice[] = SELECTABLE_MODES.map((mode) => ({
  mode,
  label: MODE_TRACK_STYLES[mode].label,
  icon: MODE_ICONS[mode],
  color: MODE_TRACK_STYLES[mode].color,
}));

/** Options par défaut : maintenant, un voyageur, tous les modes — aucune contrainte. */
export const DEFAULT_TRIP_OPTIONS: TripOptions = {
  departAt: DEPART_NOW,
  travellers: MIN_TRAVELLERS,
  modes: [...SELECTABLE_MODES],
};

/**
 * Bascule un mode dans la sélection.
 *
 * **Le dernier mode ne se décoche pas.** Une sélection vide n'est pas une
 * recherche plus large, c'est une recherche impossible : elle ne laisserait
 * constructible aucune proposition. Plutôt que de rendre une liste vide
 * inexplicable, on refuse le geste — la case reste cochée, ce qui est un retour
 * immédiat et compréhensible (C10).
 *
 * @param options État courant
 * @param mode Mode dont l'usager vient de cliquer la tuile
 * @returns Un **nouvel** état ; l'ancien, à l'identique, si le geste est refusé
 */
export function toggleMode(options: TripOptions, mode: TransportMode): TripOptions {
  const selected = options.modes.includes(mode);
  if (selected && options.modes.length === 1) return options;

  const modes = selected
    ? options.modes.filter((candidate) => candidate !== mode)
    : // On reconstruit depuis le catalogue plutôt que d'empiler : l'ordre des
      // modes envoyés reste ainsi celui de la planche, quel que soit l'ordre
      // dans lequel l'usager a cliqué.
      SELECTABLE_MODES.filter(
        (candidate) => candidate === mode || options.modes.includes(candidate),
      );

  return { ...options, modes };
}

/** Borne la taille du groupe aux valeurs que l'API accepte (C4 — côté client aussi). */
export function clampTravellers(value: number): number {
  if (!Number.isFinite(value)) return MIN_TRAVELLERS;
  return Math.min(MAX_TRAVELLERS, Math.max(MIN_TRAVELLERS, Math.round(value)));
}

/** Valeurs proposées par la chip « voyageurs ». */
export const TRAVELLER_CHOICES: readonly number[] = Array.from(
  { length: MAX_TRAVELLERS - MIN_TRAVELLERS + 1 },
  (_, index) => MIN_TRAVELLERS + index,
);

/**
 * Libellé de la chip « voyageurs », au singulier comme au pluriel.
 *
 * La planche écrit « 1 personne » sur mobile et « 1 pers. » sur desktop ; on
 * garde la forme longue partout — elle tient dans la largeur, et deux textes
 * pour un même contrôle violeraient WCAG 2.5.3 comme les onglets d'UF-803.
 */
export function travellersLabel(travellers: number): string {
  return travellers === 1 ? '1 personne' : `${travellers} personnes`;
}

/**
 * Libellé de la chip « heure de départ ».
 *
 * @param departAt Valeur du champ (`datetime-local`) ou {@link DEPART_NOW}
 * @param now Instant de référence, pour décider si la date est celle du jour
 * @returns « Maintenant », ou « Départ 08:30 » / « Départ 01/09 à 08:30 » selon
 * que la date tombe ou non le jour de référence. Une valeur illisible retombe
 * sur « Maintenant » : c'est ce que la recherche fera de toute façon, et
 * afficher `Invalid Date` serait une panne pour un défaut de saisie (C10).
 */
export function departureLabel(departAt: string, now: Date): string {
  if (departAt === DEPART_NOW) return 'Maintenant';

  const instant = parseLocalDateTime(departAt);
  if (!instant) return 'Maintenant';

  const time = `${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
  const sameDay =
    instant.getFullYear() === now.getFullYear() &&
    instant.getMonth() === now.getMonth() &&
    instant.getDate() === now.getDate();

  return sameDay
    ? `Départ ${time}`
    : `Départ ${pad(instant.getDate())}/${pad(instant.getMonth() + 1)} à ${time}`;
}

/**
 * Valeur initiale du champ `datetime-local` quand l'usager quitte « Maintenant ».
 *
 * Exprimée dans le fuseau **de l'appareil**, parce que c'est ce que le champ
 * HTML attend : lui passer un instant UTC décalerait l'affichage de deux heures
 * en été sans qu'aucune erreur ne le signale.
 */
export function toDateTimeLocalValue(instant: Date): string {
  return (
    `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}` +
    `T${pad(instant.getHours())}:${pad(instant.getMinutes())}`
  );
}

/**
 * Traduit l'état de l'écran en options de `POST /routes/plan`.
 *
 * ## Un champ absent vaut mieux qu'un champ à sa valeur par défaut
 *
 * Trois omissions, et chacune a sa raison :
 *
 * | Champ        | Omis quand…                   | Pourquoi                                                                             |
 * | ------------ | ----------------------------- | ------------------------------------------------------------------------------------ |
 * | `departAt`   | la chip est sur Maintenant    | l'instant doit être pris par le moteur, pas figé ici à la préparation de la requête   |
 * | `travellers` | le groupe est de 1            | c'est le défaut du serveur ; l'envoyer n'ajoute qu'une occasion de diverger           |
 * | `modes`      | toutes les cases sont cochées | « tous les modes » n'est pas une contrainte, et le serveur la publierait comme telle  |
 *
 * La troisième est la plus importante : sans elle, ouvrir l'écran sans rien
 * toucher ferait publier `excludedModes` par le serveur, et l'écran annoncerait
 * un filtre que personne n'a posé.
 *
 * @param options État courant du formulaire
 * @returns Les champs à ajouter à `{ from, to }` — possiblement aucun
 */
export function toPlanOptions(options: TripOptions): Omit<PlanRouteRequest, 'from' | 'to'> {
  const payload: Omit<PlanRouteRequest, 'from' | 'to'> = {};

  if (options.departAt !== DEPART_NOW) {
    const instant = parseLocalDateTime(options.departAt);
    // Sérialisé en ISO **avec fuseau** : le serveur reçoit un instant, pas une
    // heure murale, et le décalage de l'appareil ne se perd pas en route (C9).
    if (instant) payload.departAt = instant.toISOString();
  }

  if (options.travellers > MIN_TRAVELLERS) {
    payload.travellers = clampTravellers(options.travellers);
  }

  if (options.modes.length < SELECTABLE_MODES.length) {
    payload.modes = [...options.modes];
  }

  return payload;
}

/**
 * Le « mode éco » est-il actif ? — bandeau vert de la planche.
 *
 * ## Ce que le bandeau annonce, et pourquoi il ne s'allume pas toujours
 *
 * La planche affiche « Mode éco activé — les itinéraires bas carbone seront
 * proposés en premier ». C'est une **affirmation vérifiable** : elle est vraie
 * exactement quand le serveur classe par empreinte croissante, c'est-à-dire
 * quand la priorité du profil est « écolo » — le défaut du produit
 * (`DEFAULT_PREFERENCES`), donc l'état du visiteur comme du nouvel inscrit.
 *
 * Elle devient fausse dès qu'un compte a choisi la priorité « rapide » dans son
 * profil de mobilité (F1). Peindre le bandeau quand même en ferait un décor :
 * l'usager lirait « bas carbone en premier » au-dessus d'une liste classée par
 * durée. On le laisse donc suivre `sortedBy`, la seule information qui dise ce
 * que le serveur a réellement fait.
 *
 * @param sortedBy Clé de tri publiée par la dernière réponse, `null` avant la première
 * @returns `true` tant que le classement est — ou sera — l'empreinte croissante
 */
export function isEcoModeActive(sortedBy: ItinerarySortKey | null): boolean {
  // Avant la première recherche, il n'y a pas encore de réponse à lire : on
  // annonce le défaut du produit, qui est celui qui s'appliquera.
  return sortedBy === null || sortedBy === 'carbonAsc';
}

/**
 * Phrase décrivant les contraintes de recherche que l'usager vient de poser
 * (UF-804), ou `null` s'il n'en a posé aucune.
 *
 * Le pendant de `describeAppliedConstraints` (UF-602) pour les contraintes de
 * **l'écran**. Le raisonnement est le même — une liste courte ou vide
 * n'explique pas d'elle-même ce qui l'a réduite —, mais la conclusion à en
 * tirer diffère. Un filtre PMR se règle dans le profil, des semaines plus tôt ;
 * un mode décoché se re-coche ici, tout de suite. La phrase le dit.
 *
 * @param constraints Contraintes publiées par le serveur, `null` si inconnues
 * @returns Le message, ou `null` — l'écran n'affiche alors rien
 */
export function describeSearchOptions(constraints: AppliedRouteConstraints | null): string | null {
  if (!constraints) return null;

  const parts: string[] = [];

  if (constraints.excludedModes && constraints.excludedModes.length > 0) {
    const names = constraints.excludedModes
      .map((mode) => MODE_TRACK_STYLES[mode].label.toLowerCase())
      .join(', ');
    parts.push(`les modes suivants sont écartés (${names})`);
  }

  if (constraints.travellers !== undefined) {
    parts.push(
      `seules les stations proposant ${constraints.travellers} véhicules ou plus sont retenues`,
    );
  }

  if (parts.length === 0) return null;

  return (
    `Vos options de recherche restreignent les résultats : ${parts.join(' ; ')}. ` +
    'Modifiez-les au-dessus pour élargir la recherche.'
  );
}

/** Deux chiffres, zéro devant — la forme qu'attendent `datetime-local` et l'affichage. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Lit une valeur `datetime-local` (`AAAA-MM-JJTHH:MM`) comme une heure **locale**.
 *
 * `new Date('2026-09-01T08:30')` est aujourd'hui interprété en heure locale par
 * les moteurs, mais la même chaîne suffixée d'un `Z` bascule en UTC et un champ
 * vidé rend `Invalid Date`. On construit donc la date champ par champ : c'est
 * la seule forme dont le comportement ne dépende pas d'un caractère de trop.
 *
 * @returns `null` sur une chaîne illisible — un champ vidé n'est pas une panne
 */
function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;

  const [, year, month, day, hours, minutes] = match.map(Number);
  const instant = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isNaN(instant.getTime()) ? null : instant;
}
