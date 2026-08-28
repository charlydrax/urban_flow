import { TransportMode, type Itinerary, type ItinerarySortKey } from '@urbanflow/shared';

import { formatCarbon } from './format-carbon';
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
 * Raison pour laquelle le premier itinéraire de la liste est en tête, formulée
 * à partir de la clé de tri **publiée par le serveur** (`sortedBy`).
 *
 * On ne redéduit rien en comparant les valeurs entre elles : le serveur a trié
 * selon la priorité du profil (F1), il dit laquelle, et l'écran se contente de
 * la traduire. Le jour où une troisième priorité apparaît, ce `Record` cesse de
 * compiler — c'est exactement ce qu'on veut.
 */
export const BEST_OPTION_REASON: Record<ItinerarySortKey, string> = {
  carbonAsc: 'Meilleur choix · empreinte la plus faible',
  durationAsc: 'Meilleur choix · le plus rapide',
};

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
 * @param itinerary Itinéraire décrit
 * @param position Rang dans la liste, à partir de 1
 * @param total Nombre d'itinéraires proposés
 * @returns Phrase complète, prête pour un `aria-label`
 */
export function describeItinerary(itinerary: Itinerary, position: number, total: number): string {
  const legs = modeSequence(itinerary).map((leg) => {
    const named = leg.line ? `${leg.label} ${leg.line}` : leg.label;
    return `${named} ${leg.durationMinutes} min`;
  });

  const parts = [
    `Option ${position} sur ${total}`,
    `${itinerary.durationMinutes} minutes`,
    legs.join(', puis '),
  ];

  const clock = itineraryClock(itinerary);
  if (clock) parts.push(`départ ${clock.departure}, arrivée ${clock.arrival}`);

  parts.push(formatCarbon(itinerary.carbonGrams));
  if (itinerary.accessible) parts.push('accessible en fauteuil roulant');

  return `${parts.join('. ')}.`;
}
