import {
  TransportMode,
  type Itinerary,
  type RouteSegment,
  type SharedMobilityStation,
  type TransportSourceStatus,
} from '@urbanflow/shared';

import { MODE_ICONS, formatClock } from './itinerary-cards';
import { MODE_TRACK_STYLES } from './route-map-layers';

/**
 * Modèle des **deux cartes temps réel** de l'écran de résultats (UF-804) — les
 * deux encarts « données F3 » du bas de la planche Figma
 * (« 5. RÉSULTATS F2+F3 » : une station Vélo'v, un prochain passage TC).
 *
 * Module **pur** : il transforme ce que les endpoints `transport` ont rendu en
 * ce que les cartes doivent peindre. Aucun `fetch`, aucun React — testable dans
 * l'environnement `node` de Vitest, comme `itinerary-cards.ts`.
 *
 * ## Ce que ces cartes disent, et ce qu'elles ne disent pas
 *
 * La planche annonce « passe dans 4 min » sous une étiquette « GTFS-RT ». Nous
 * n'avons **pas** de GTFS temps réel : le flux officiel TCL est fermé (401) et
 * la source réellement branchée est un miroir statique daté (voir
 * `docs/otp-gtfs.md`). Écrire « passe dans 4 min » à partir d'un horaire
 * théorique serait un mensonge — et un mensonge invérifiable par l'usager tant
 * qu'il n'est pas à l'arrêt.
 *
 * Ces cartes affichent donc ce que nos sources savent vraiment :
 *
 * | Carte           | Source                            | Fraîcheur réelle                      |
 * | --------------- | --------------------------------- | ------------------------------------- |
 * | Station         | `GET /transport/stations/nearby`  | **temps réel** (flux GBFS, quelques minutes) |
 * | Prochain départ | horaire GTFS de l'option retenue  | **théorique** (horaire publié, pas la position du véhicule) |
 *
 * Et chacune **porte sa provenance à l'écran**, alimentée par
 * `GET /transport/status` : c'est ce qui sépare une carte informative d'une
 * carte décorative (C9, C10). Le suivi temps réel proprement dit — la position
 * du véhicule pendant le trajet — est le sujet du ticket UF-806.
 */

/** Vitesse de marche du modèle de trajet côté API — gardée identique (C9). */
const WALK_SPEED_METERS_PER_MINUTE = 80;

/** Un encart temps réel prêt à peindre. */
export interface RealtimeCard {
  /** Identité stable dans la liste. */
  key: 'station' | 'departure';
  /** Pictogramme décoratif, à poser en `aria-hidden`. */
  icon: string;
  /** Titre de l'encart (« Station Vélo'v — Lafayette »). */
  title: string;
  /** Ligne de détail (« À 3 min · 7 vélos disponibles »). */
  detail: string;
  /**
   * Fait saillant repris en gras dans le détail — la partie que l'œil doit
   * accrocher. `null` quand l'encart n'a rien à mettre en avant.
   */
  emphasis: string | null;
  /** Provenance affichée en petit, à droite (« GBFS · temps réel »). */
  provenance: string;
  /**
   * Phrase complète pour les technologies d'assistance.
   *
   * L'encart est un empilement de fragments — « 🚲 », « À 3 min », « 7 vélos » —
   * qu'un lecteur d'écran énoncerait tels quels sans jamais dire de quoi il
   * s'agit. Cette phrase est ce qu'il annonce à la place (C7 — WCAG 1.1.1).
   */
  description: string;
  /** `true` quand la donnée est fraîche mais que sa source est signalée figée (C10). */
  stale: boolean;
}

/** Trouve l'état d'une source dans la réponse de `GET /transport/status`. */
function sourceStatus(
  statuses: readonly TransportSourceStatus[],
  source: TransportSourceStatus['source'],
): TransportSourceStatus | null {
  return statuses.find((status) => status.source === source) ?? null;
}

/**
 * Carte « station en libre-service la plus proche du départ ».
 *
 * La station retenue est la **première** de la réponse : l'API les rend déjà
 * triées par distance croissante, et refaire ce tri ici reviendrait à
 * recalculer une décision déjà prise, avec le risque de la prendre autrement.
 *
 * Une station qui ne loue pas est écartée : la carte annonce une option, pas un
 * point sur une carte. Sans candidate louante, elle n'est pas rendue — un
 * encart « 0 vélo disponible » occuperait la place sans rien proposer.
 *
 * @param stations Stations rendues par `GET /transport/stations/nearby`
 * @param statuses État des sources, pour la ligne de provenance
 * @returns L'encart, ou `null` s'il n'y a rien d'honnête à afficher
 */
export function stationCard(
  stations: readonly SharedMobilityStation[],
  statuses: readonly TransportSourceStatus[],
): RealtimeCard | null {
  const station = stations.find(
    (candidate) => candidate.renting && candidate.vehiclesAvailable > 0,
  );
  if (!station) return null;

  const walkMinutes = Math.max(
    1,
    Math.round(station.distanceMeters / WALK_SPEED_METERS_PER_MINUTE),
  );
  const vehicles = `${station.vehiclesAvailable} véhicule${station.vehiclesAvailable > 1 ? 's' : ''} disponible${station.vehiclesAvailable > 1 ? 's' : ''}`;

  const gbfs = sourceStatus(statuses, 'gbfs');
  const stale = gbfs?.status === 'degraded';

  return {
    key: 'station',
    icon: MODE_ICONS[TransportMode.BIKE],
    title: `Station en libre-service — ${station.name}`,
    detail: `À ${walkMinutes} min à pied`,
    emphasis: vehicles,
    // « GBFS » seul ne dit rien à un usager ; « temps réel » sans le format ne
    // dit rien à un relecteur technique. Les deux tiennent en une ligne.
    provenance: stale ? 'GBFS · flux figé' : 'GBFS · temps réel',
    description:
      `Station de véhicules en libre-service ${station.name}, à ${walkMinutes} minutes à pied, ` +
      `${vehicles}. Disponibilité issue du flux GBFS de l’opérateur` +
      (stale ? ', qui n’a pas été republié depuis un moment.' : ', en temps réel.'),
    stale,
  };
}

/**
 * Premier segment en transport en commun d'un itinéraire.
 *
 * Le premier et non le plus long : la carte annonce ce qu'il faut **attraper**,
 * et c'est le premier véhicule qui impose l'heure de départ. Une correspondance
 * plus loin dans le trajet n'est pas une chose que l'usager peut manquer depuis
 * son canapé.
 */
function firstTransitSegment(itinerary: Itinerary): RouteSegment | null {
  const TRANSIT_MODES: readonly TransportMode[] = [
    TransportMode.BUS,
    TransportMode.TRAM,
    TransportMode.METRO,
  ];
  return itinerary.segments.find((segment) => TRANSIT_MODES.includes(segment.mode)) ?? null;
}

/**
 * Carte « prochain départ en transport en commun » de l'itinéraire retenu.
 *
 * ## Pourquoi l'itinéraire retenu, et pas l'arrêt le plus proche
 *
 * La planche montre « Bus C3 → Part-Dieu · Arrêt Cordeliers · passe dans
 * 4 min », c'est-à-dire un départ pris **près de l'usager**. Nous n'avons pas
 * d'endpoint « prochains passages à cet arrêt » : le moteur GTFS planifie des
 * trajets, il ne publie pas de tableau de départs. En construire un
 * demanderait une requête par arrêt voisin, pour une information que l'écran de
 * résultats possède déjà — l'option affichée porte sa ligne, son arrêt et son
 * horaire.
 *
 * On affiche donc le premier départ **de l'option que l'usager regarde**. C'est
 * la même information, rattachée à une décision qu'il vient de prendre, et
 * obtenue sans une seule requête de plus (C5).
 *
 * ## L'horaire est théorique, et la carte le dit
 *
 * `departureAt` vient du GTFS : c'est l'horaire **publié**, pas la position du
 * véhicule. La carte affiche donc une heure (« départ 09:47 ») et jamais un
 * décompte (« dans 4 min ») — un décompte affirme qu'on suit le véhicule, ce
 * que nous ne faisons pas. La provenance le répète en toutes lettres.
 *
 * @param itinerary Itinéraire retenu, `null` si aucun
 * @param statuses État des sources, pour la ligne de provenance
 * @returns L'encart, ou `null` si l'option retenue n'emprunte aucun TC
 */
export function departureCard(
  itinerary: Itinerary | null,
  statuses: readonly TransportSourceStatus[],
): RealtimeCard | null {
  if (!itinerary) return null;

  const segment = firstTransitSegment(itinerary);
  if (!segment) return null;

  const style = MODE_TRACK_STYLES[segment.mode];
  const line = segment.line ? `${style.label} ${segment.line}` : style.label;
  const clock = formatClock(segment.departureAt);

  const gtfs = sourceStatus(statuses, 'gtfs');
  const down = gtfs?.status === 'down';

  return {
    key: 'departure',
    icon: MODE_ICONS[segment.mode],
    title: `${line} → ${segment.to}`,
    // Le détail porte le lieu, l'emphase porte l'heure — jamais les deux, sinon
    // la carte affiche « Arrêt X · départ à 19:42 · départ à 19:42 », l'encart
    // les recollant avec un point médian. Même répartition que la carte
    // station (« À 3 min à pied » + « 7 véhicules disponibles »), et même
    // lecture que la planche : « Arrêt Cordeliers · **passe dans 4 min** ».
    detail: `Arrêt ${segment.from}`,
    // Un segment TC sans horaire ne devrait pas exister — le GTFS en publie
    // toujours un —, mais laisser l'emphase vide vaut mieux qu'inventer une heure.
    emphasis: clock ? `départ à ${clock}` : null,
    provenance: down ? 'GTFS · source injoignable' : 'GTFS · horaire théorique',
    description:
      `Prochain départ de votre itinéraire : ${line} vers ${segment.to}, arrêt ${segment.from}` +
      (clock ? `, départ prévu à ${clock}` : '') +
      '. Horaire théorique publié par le réseau, pas la position réelle du véhicule.',
    // Un horaire théorique n'est pas « périmé » : il est ce qu'il annonce être.
    // Seule une source injoignable justifie la nuance visuelle.
    stale: down,
  };
}
