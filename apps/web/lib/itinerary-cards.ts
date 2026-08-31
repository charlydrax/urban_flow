import { TransportMode, type Itinerary, type ItinerarySortKey } from '@urbanflow/shared';

import { carbonBadge } from './carbon-badge';
import { MODE_TRACK_STYLES } from './route-map-layers';

/**
 * Données d'affichage du panneau de résultats (UF-404) — séquence de modes,
 * horaires et libellés lus par les technologies d'assistance.
 *
 * Module **pur** : il ne connaît ni React ni MapLibre, il transforme un
 * `Itinerary` en ce que la carte de résultat a besoin de peindre. C'est ce qui
 * le rend testable dans l'environnement `node` de Vitest, où les tests de
 * composants (jsdom) n'existent pas encore — même stratégie que
 * `route-map-layers.ts` pour UF-403.
 *
 * Couvre : C7 (libellés textuels doublant les pastilles colorées, WCAG 1.4.1 et
 * 4.1.2), C9 (horaires ISO 8601 lus tels que la source les publie), C2 (une
 * séquence compactée reste lisible sur un écran étroit).
 */

/**
 * Pictogramme de chaque mode — repris de la maquette « 5. RÉSULTATS F2+F3 » et
 * du design system (UF-007, « Badges — états & modes »).
 *
 * Des emoji plutôt qu'un jeu d'icônes : ils sont déjà le vocabulaire de la
 * charte, ils ne coûtent pas un octet de plus au bundle (C5), et ils suivent la
 * taille du texte sans réglage. Ils sont **toujours** posés en `aria-hidden`,
 * doublés du libellé écrit du mode : « 🚌 » énoncé par un lecteur d'écran donne
 * « bus » dans le meilleur des cas et « emoji autobus » dans le pire — ce n'est
 * pas une alternative textuelle acceptable (C7 — WCAG 1.1.1).
 */
export const MODE_ICONS: Record<TransportMode, string> = {
  [TransportMode.WALK]: '🚶',
  [TransportMode.BIKE]: '🚲',
  [TransportMode.SCOOTER]: '🛴',
  [TransportMode.BUS]: '🚌',
  [TransportMode.TRAM]: '🚊',
  [TransportMode.METRO]: '🚇',
  [TransportMode.CARPOOL]: '🚗',
};

/** Une étape de la séquence affichée sur une carte de résultat. */
export interface ModeLeg {
  /** Identité stable dans la liste — l'index d'origine suffit, l'ordre ne bouge pas. */
  key: string;
  mode: TransportMode;
  /** Pictogramme décoratif, à poser en `aria-hidden`. */
  icon: string;
  /** Libellé écrit du mode (« Bus », « Métro ») — porte l'information, pas l'icône. */
  label: string;
  /**
   * Couleur du mode, **identique** à celle de son tracé sur la carte
   * (`MODE_TRACK_STYLES`). C'est ce qui relie la pastille au trait dessiné :
   * deux nuances différentes pour un même bus rompraient le lien que la recette
   * du ticket demande d'établir entre la liste et la carte.
   */
  color: string;
  /** Durée cumulée de l'étape, en minutes. */
  durationMinutes: number;
  /** Numéro de ligne commercial (« C3 », « B »), quand la source le donne. */
  line?: string;
}

/**
 * Séquence de modes d'un itinéraire, façon « 🚶 3 › 🚲 11 › 🚌 C3 6 ».
 *
 * Les segments **consécutifs de même mode et même ligne** sont fusionnés et
 * leurs durées additionnées. Sans cela, un métro B repris après un changement
 * de quai afficherait deux pastilles identiques côte à côte : le lecteur y
 * verrait deux trajets là où il n'y en a qu'un. Deux lignes de bus différentes,
 * en revanche, restent deux pastilles — c'est bien un changement de véhicule.
 *
 * Contrairement à `Itinerary.summary`, qui est une phrase déjà composée par le
 * serveur, cette séquence garde les durées : c'est ce qui permet de voir qu'un
 * itinéraire « Marche + Bus » de 22 min est en réalité 18 min de marche.
 *
 * @param itinerary Itinéraire à résumer
 * @returns Étapes dans l'ordre du trajet ; tableau vide si aucun segment
 */
export function modeSequence(itinerary: Itinerary): ModeLeg[] {
  const legs: ModeLeg[] = [];

  itinerary.segments.forEach((segment, index) => {
    const previous = legs[legs.length - 1];
    if (previous && previous.mode === segment.mode && previous.line === segment.line) {
      previous.durationMinutes += segment.durationMinutes;
      return;
    }

    const style = MODE_TRACK_STYLES[segment.mode];
    legs.push({
      key: `${itinerary.id}:${index}`,
      mode: segment.mode,
      icon: MODE_ICONS[segment.mode],
      label: style.label,
      color: style.color,
      durationMinutes: segment.durationMinutes,
      ...(segment.line ? { line: segment.line } : {}),
    });
  });

  return legs;
}

/** Fuseau du réseau TCL — un horaire GTFS est une heure locale de quai. */
const TRANSIT_TIME_ZONE = 'Europe/Paris';

/**
 * Heure de l'horloge d'un instant ISO 8601, façon « 09:47 ».
 *
 * Le fuseau est **forcé sur celui du réseau** (Europe/Paris) et non laissé à
 * celui du navigateur : un usager dont le poste est resté à l'heure de Londres
 * doit lire l'heure à laquelle le bus passe à Lyon, pas sa traduction locale (C9).
 *
 * @param iso Instant ISO 8601 avec fuseau
 * @returns `HH:MM`, ou `null` si l'horodatage est absent ou illisible — un
 * horaire manquant n'est pas une panne, la carte n'affiche alors que sa durée (C10)
 */
export function formatClock(iso: string | undefined): string | null {
  if (!iso) return null;

  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;

  return instant.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TRANSIT_TIME_ZONE,
  });
}

/** Fenêtre horaire affichée sur une carte, quand la source en publie une. */
export interface ItineraryClock {
  departure: string;
  arrival: string;
}

/**
 * Créneau « départ → arrivée » d'un itinéraire (recette : « heure de départ /
 * arrivée si TC »).
 *
 * @param itinerary Itinéraire à dater
 * @returns `null` dès qu'une des deux bornes manque : un itinéraire tout-vélo
 * n'a pas d'heure de départ — il part quand l'usager décide. Afficher une borne
 * seule (« arrivée 10:03 ») sans dire de quand on part serait plus trompeur que
 * de n'en afficher aucune.
 */
export function itineraryClock(itinerary: Itinerary): ItineraryClock | null {
  const departure = formatClock(itinerary.departureAt);
  const arrival = formatClock(itinerary.arrivalAt);
  if (!departure || !arrival) return null;

  return { departure, arrival };
}

/**
 * Mise en avant portée par un itinéraire — indépendante de sa **position**.
 *
 * UF-404 badgeait la première carte de la liste, et se contentait de traduire
 * `sortedBy` pour dire pourquoi elle était première. UF-503 rend l'ordre
 * d'affichage modifiable par l'usager : la position ne prouve donc plus rien,
 * et un badge posé sur « la première » désignerait l'option la plus rapide
 * comme la plus écologique sitôt le tri par durée choisi.
 *
 * La mise en avant est désormais **une propriété de l'itinéraire**, calculée
 * sur ses propres valeurs. Elle suit sa carte où que le tri l'emmène.
 */
export interface ItineraryHighlight {
  /** Empreinte la plus faible de la liste — la mise en avant que le produit assume. */
  greenest: boolean;
  /** Durée la plus courte de la liste. */
  fastest: boolean;
}

/** Libellés des deux mises en avant, repris tels quels par la carte et par l'`aria-label`. */
export const HIGHLIGHT_LABELS = {
  greenest: 'Choix vert · empreinte la plus faible',
  fastest: 'Le plus rapide',
} as const;

/**
 * Désigne l'option la plus écologique et la plus rapide d'une liste
 * (recette 2 d'UF-503 : « l'option la plus écologique est visuellement mise
 * en avant »).
 *
 * ## Pourquoi le client a le droit de calculer ça
 *
 * Le hook `use-route-plan` s'interdit de rejouer les décisions du serveur, et
 * ce n'en est pas une : c'est un **minimum sur les valeurs publiées**, pas un
 * second barème carbone. Le serveur reste seul à dire combien pèse un trajet ;
 * l'écran se contente de repérer lequel pèse le moins parmi ceux qu'il a reçus.
 * Aucune divergence possible — il n'y a rien à garder en phase.
 *
 * ## Ex æquo
 *
 * Le badge va au **premier** de l'ordre publié par le serveur, jamais aux deux :
 * deux « choix vert » côte à côte ne mettent plus rien en avant. Le départage
 * est donc celui du serveur (empreinte, puis durée), qui a déjà tranché.
 *
 * Un même itinéraire peut porter les deux badges : c'est le cas heureux, et le
 * cacher priverait l'usager de l'argument le plus fort qu'on ait à lui donner.
 *
 * @param itineraries Itinéraires reçus, dans l'ordre publié par le serveur
 * @returns Mise en avant par identifiant d'itinéraire ; vide si la liste l'est
 */
export function itineraryHighlights(
  itineraries: readonly Itinerary[],
): Record<string, ItineraryHighlight> {
  if (itineraries.length === 0) return {};

  const greenest = pickBy(itineraries, (itinerary) => itinerary.carbonGrams);
  const fastest = pickBy(itineraries, (itinerary) => itinerary.durationMinutes);

  const highlights: Record<string, ItineraryHighlight> = {};
  for (const itinerary of itineraries) {
    const marks = {
      greenest: itinerary.id === greenest,
      fastest: itinerary.id === fastest,
    };
    if (marks.greenest || marks.fastest) highlights[itinerary.id] = marks;
  }

  return highlights;
}

/** Identifiant de l'itinéraire minimisant `value` — le premier rencontré en cas d'ex æquo. */
function pickBy(
  itineraries: readonly Itinerary[],
  value: (itinerary: Itinerary) => number,
): string | null {
  let best: Itinerary | null = null;
  for (const itinerary of itineraries) {
    if (!best || value(itinerary) < value(best)) best = itinerary;
  }
  return best?.id ?? null;
}

/**
 * Phrase annonçant les mises en avant d'un itinéraire aux technologies
 * d'assistance, ou `null` s'il n'en porte aucune.
 *
 * Les badges sont peints en couleur et en gras ; sans cette reprise écrite,
 * l'information « c'est celui-là le plus écologique » n'existerait que
 * visuellement (C7 — WCAG 1.4.1).
 */
export function describeHighlight(highlight: ItineraryHighlight | undefined): string | null {
  if (!highlight) return null;

  const marks: string[] = [];
  if (highlight.greenest) marks.push(HIGHLIGHT_LABELS.greenest);
  if (highlight.fastest) marks.push(HIGHLIGHT_LABELS.fastest);

  return marks.length > 0 ? marks.join('. ') : null;
}

/**
 * Comparateurs de **vue** du panneau de résultats (UF-503).
 *
 * Ce sont les mêmes règles que celles du serveur (`comparatorFor` dans
 * `modules/routes/merge/itinerary-merger.ts`), départage compris : à empreinte
 * égale on classe sur la durée, et réciproquement. Sans ce second critère,
 * l'ordre d'un ex æquo dépendrait de la stabilité du `sort` du moteur.
 *
 * **Cette duplication est assumée**, et elle est bornée : le serveur reste
 * l'autorité sur l'ordre *publié* — celui qu'annonce `sortedBy` et sur lequel
 * l'écran s'ouvre. Le front ne recalcule que le retri **demandé par l'usager**,
 * qui n'existe pas côté serveur et n'a donc rien à contredire. L'alternative —
 * redemander la liste à l'API à chaque bascule — relancerait la collecte des
 * trois sources et pourrait renvoyer des itinéraires *différents* : un retri
 * doit réordonner ce qu'on a sous les yeux, pas en changer le contenu.
 */
const VIEW_COMPARATORS: Record<ItinerarySortKey, (a: Itinerary, b: Itinerary) => number> = {
  carbonAsc: (a, b) => a.carbonGrams - b.carbonGrams || a.durationMinutes - b.durationMinutes,
  durationAsc: (a, b) => a.durationMinutes - b.durationMinutes || a.carbonGrams - b.carbonGrams,
};

/** Libellé du tri **publié par le serveur**, annoncé sous le décompte. */
export const SORT_LABELS: Record<ItinerarySortKey, string> = {
  carbonAsc: 'classés par empreinte carbone croissante',
  durationAsc: 'classés par durée croissante',
};

// ------------------------------------------------- les quatre vues (UF-804)

/**
 * Clé d'une des **quatre vues** du panneau de résultats (UF-804).
 *
 * La planche Figma (« 5. RÉSULTATS F2+F3 ») pose quatre pastilles — Tous,
 * Rapide, Écolo, Économe — là où UF-503 n'en avait livré que deux. Le type est
 * distinct d'`ItinerarySortKey`, et ce n'est pas un détail : `ItinerarySortKey`
 * est le **contrat serveur**, celui que `sortedBy` publie et que le serveur
 * sait appliquer. Ces quatre-là sont des vues **du client**, qui n'existent que
 * dans ce panneau. Les confondre laisserait croire qu'on peut demander
 * « Économe » à l'API.
 */
export type ItineraryViewKey = 'all' | 'durationAsc' | 'carbonAsc' | 'fareAsc';

/** Une pastille du bandeau de filtres. */
export interface ItineraryView {
  key: ItineraryViewKey;
  /** Intitulé de la planche. */
  label: string;
  /** Pictogramme décoratif, à poser en `aria-hidden`. */
  icon: string;
  /** Ce que la vue fait, annoncé sous le décompte et repris par le lecteur d'écran. */
  description: string;
}

/**
 * Les quatre vues, dans l'ordre de la planche.
 *
 * « Tous » vient en premier, et c'est elle qui est active à l'ouverture : c'est
 * la pastille sombre de la maquette, et surtout l'ordre **publié par le
 * serveur**. Les trois autres sont des relectures de la même liste.
 *
 * ## L'écart assumé sur « Économe »
 *
 * La planche affiche un prix sur chaque carte (« 1,90 € »). Nous n'en avons
 * aucun : ni le GTFS TCL ni le flux GBFS ne publient de tarif, et le périmètre
 * du projet (CLAUDE.md §3) ne comporte aucune intégration billettique.
 * Fabriquer une grille tarifaire pour remplir la pastille reviendrait à
 * afficher un chiffre inventé à côté de chiffres mesurés — exactement ce que le
 * reste du produit s'interdit (C9).
 *
 * « Économe » est donc appliqué à la seule donnée de coût que nous possédions
 * réellement : le **nombre de titres de transport** à sortir, compté sur les
 * segments (voir {@link fareCount}). Marcher ne coûte rien, un métro coûte un
 * ticket, deux lignes de bus en coûtent deux. C'est moins précis qu'un prix, ce
 * n'est pas faux, et cela classe les options dans le même ordre la plupart du
 * temps.
 */
export const ITINERARY_VIEWS: readonly ItineraryView[] = [
  { key: 'all', label: 'Tous', icon: '☰', description: 'dans l’ordre proposé par UrbanFlow' },
  { key: 'durationAsc', label: 'Rapide', icon: '⚡', description: 'classés par durée croissante' },
  {
    key: 'carbonAsc',
    label: 'Écolo',
    icon: '🌱',
    description: 'classés par empreinte carbone croissante',
  },
  {
    key: 'fareAsc',
    label: 'Économe',
    icon: '💶',
    description: 'classés par nombre de titres de transport croissant',
  },
];

/** Retrouve une vue par sa clé — le catalogue est court, la recherche linéaire suffit. */
export function itineraryView(key: ItineraryViewKey): ItineraryView {
  // « Tous » est le repli : une clé inconnue ne peut venir que d'un état
  // corrompu, et rendre la liste dans l'ordre du serveur reste une réponse
  // valide.
  return ITINERARY_VIEWS.find((view) => view.key === key) ?? ITINERARY_VIEWS[0];
}

/**
 * Nombre de titres de transport à payer pour un itinéraire.
 *
 * Compte **une unité par service payant emprunté**, et non par segment : un
 * métro B repris après un changement de quai reste un ticket. Deux lignes de
 * bus différentes en font deux ; un vélo en libre-service en fait un, quelle
 * que soit la longueur du trajet. La marche ne compte pas.
 *
 * Ce n'est pas un prix, et le nom le dit. Voir {@link ITINERARY_VIEWS} pour la
 * raison pour laquelle on n'en calcule pas.
 *
 * @param itinerary Itinéraire à évaluer
 * @returns Le nombre de titres, `0` pour un itinéraire entièrement à pied
 */
export function fareCount(itinerary: Itinerary): number {
  const fares = new Set<string>();

  for (const segment of itinerary.segments) {
    if (segment.mode === TransportMode.WALK) continue;
    // La ligne distingue deux bus l'un de l'autre ; en son absence (un vélo en
    // libre-service n'en a pas), le mode suffit à identifier le service.
    fares.add(segment.line ? `${segment.mode}:${segment.line}` : segment.mode);
  }

  return fares.size;
}

/**
 * Comparateurs des trois vues qui réordonnent (« Tous » n'en a pas besoin).
 *
 * Chacun porte un second critère, pour la même raison que
 * {@link VIEW_COMPARATORS} : sans lui, l'ordre d'un ex æquo dépendrait de la
 * stabilité du `sort` du moteur. « Économe » départage sur la durée — à titres
 * égaux, le trajet le plus court est le meilleur.
 */
const FILTER_COMPARATORS: Record<
  Exclude<ItineraryViewKey, 'all'>,
  (a: Itinerary, b: Itinerary) => number
> = {
  carbonAsc: VIEW_COMPARATORS.carbonAsc,
  durationAsc: VIEW_COMPARATORS.durationAsc,
  fareAsc: (a, b) => fareCount(a) - fareCount(b) || a.durationMinutes - b.durationMinutes,
};

/**
 * Applique une vue à la liste reçue du serveur.
 *
 * Les quatre vues **réordonnent** ; aucune ne retire d'itinéraire. C'est une
 * décision, pas un raccourci : cacher des options derrière une pastille ferait
 * disparaître de l'écran, sans le dire, des trajets que le serveur juge
 * pertinents — et l'usager qui clique « Écolo » veut voir le plus écologique
 * *en premier*, pas être privé des autres. Le mot « filtre » vient de la
 * planche ; le geste, lui, reste une relecture.
 *
 * @param itineraries Itinéraires reçus, dans l'ordre publié par le serveur
 * @param view Vue active
 * @returns Une **nouvelle** liste — muter le tableau d'état de React ne
 * déclencherait aucun rendu, et ferait diverger la liste de ce que la carte trace
 */
export function applyItineraryView(
  itineraries: readonly Itinerary[],
  view: ItineraryViewKey,
): Itinerary[] {
  if (view === 'all') return [...itineraries];
  return [...itineraries].sort(FILTER_COMPARATORS[view]);
}

/**
 * Libellé complet du classement affiché, posé sous le décompte.
 *
 * « Tous » est le seul cas où la vue ne dit pas tout : l'ordre est celui du
 * serveur, et c'est `sortedBy` qui le décrit. Sans cette reprise, un usager
 * resté sur « Tous » n'aurait aucun moyen de savoir sur quel critère sa liste
 * est classée.
 *
 * @param view Vue active
 * @param serverSort Clé publiée par le serveur, `null` avant la première réponse
 */
export function describeItineraryView(
  view: ItineraryViewKey,
  serverSort: ItinerarySortKey | null,
): string {
  if (view !== 'all') return itineraryView(view).description;
  return serverSort ? SORT_LABELS[serverSort] : itineraryView('all').description;
}

/**
 * Description d'un itinéraire en une phrase, pour les technologies d'assistance
 * (C7 — WCAG 1.1.1 / 4.1.2).
 *
 * La carte de résultat est un empilement de fragments — « 22 min », « 🚶 3 »,
 * « › », « 240 g CO₂ » — qu'un lecteur d'écran énoncerait tels quels, sans
 * jamais dire de quoi il s'agit. Cette phrase est ce qu'il annonce à la place,
 * et c'est elle qui doit rester exacte : elle nomme les modes en toutes lettres
 * là où l'affichage se repose sur des pictogrammes et des couleurs.
 *
 * Depuis UF-503 elle porte aussi la **mise en avant** : les badges « Choix
 * vert » et « Le plus rapide » sont peints dans la carte, mais l'`aria-label`
 * du bouton radio remplace l'énoncé de son contenu — sans les y reprendre, ils
 * ne seraient jamais lus (C7 — WCAG 1.4.1).
 *
 * @param itinerary Itinéraire décrit
 * @param position Rang dans la liste, à partir de 1
 * @param total Nombre d'itinéraires proposés
 * @param highlight Mises en avant portées par cet itinéraire, s'il en porte
 * @returns Phrase complète, prête pour un `aria-label`
 */
export function describeItinerary(
  itinerary: Itinerary,
  position: number,
  total: number,
  highlight?: ItineraryHighlight,
): string {
  const legs = modeSequence(itinerary).map((leg) => {
    const named = leg.line ? `${leg.label} ${leg.line}` : leg.label;
    return `${named} ${leg.durationMinutes} min`;
  });

  const parts = [
    `Option ${position} sur ${total}`,
    `${itinerary.durationMinutes} minutes`,
    legs.join(', puis '),
  ];

  // Annoncée juste après le rang : « Option 2 sur 4. Choix vert… » dit
  // immédiatement pourquoi cette option compte, sans attendre la fin de la phrase.
  const marks = describeHighlight(highlight);
  if (marks) parts.splice(1, 0, marks);

  const clock = itineraryClock(itinerary);
  if (clock) parts.push(`départ ${clock.departure}, arrivée ${clock.arrival}`);

  // Le badge CO₂ est peint en couleur et en pictogramme (UF-504) : sans cette
  // reprise écrite, « c'est celui-ci qui pèse le moins » n'existerait que
  // visuellement. La phrase du badge nomme le niveau *et* la comparaison
  // voiture — « 240 g CO₂ » seul ne dit toujours pas si c'est bien ou mal.
  parts.push(carbonBadge(itinerary).description);
  if (itinerary.accessible) parts.push('accessible en fauteuil roulant');

  return `${parts.join('. ')}.`;
}
