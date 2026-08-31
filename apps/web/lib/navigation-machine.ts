import type { Itinerary, RouteSegment } from '@urbanflow/shared';

import type { GeolocationFailureReason, UserPosition } from './geolocation';
import { GEOLOCATION_ERROR_MESSAGES } from './geolocation';
import { MODE_ICONS } from './itinerary-cards';
import { computeRouteProgress, type RouteProgress } from './route-progress';
import { MODE_TRACK_STYLES } from './route-map-layers';

/**
 * Machine à états du guidage (UF-806) — la vie d'une session de navigation, de
 * « Démarrer » à « Vous êtes arrivé ».
 *
 * Module **pur** : un réducteur `(état, événement) → état` et les libellés qui
 * s'en déduisent. Aucun `watchPosition`, aucun `setInterval`, aucun composant —
 * le hook `features/navigation/use-navigation.ts` branche le capteur dessus, et
 * lui seul a besoin d'un navigateur.
 *
 * Ce découpage est ce qui rend la recette du ticket vérifiable sans GPS : «
 * la progression avance de segment en segment jusqu'à l'arrivée » et « la perte
 * de signal est gérée proprement » sont des suites d'événements qu'on rejoue en
 * quelques lignes de test (`navigation-machine.test.ts`).
 *
 * ## Les états, et ce qui fait passer de l'un à l'autre
 *
 * ```
 *              start                position (arrived)
 *   idle ─────────────► guiding ──────────────────────► arrived
 *    ▲                  │   ▲                              │
 *    │            pause │   │ resume / position            │ stop
 *    │                  ▼   │                              │
 *    │                 paused                              │
 *    │                  │                                  │
 *    │                  │  signal-lost                     │
 *    │                  ▼                                  │
 *    │            signal-lost ──── position ──► guiding    │
 *    └──────────────────┴──────── stop ────────────────────┘
 * ```
 *
 * « Segment suivant » n'est **pas** un état : c'est un `segmentIndex` qui
 * change à l'intérieur de `guiding`. En faire un état obligerait à en sortir à
 * chaque tronçon, alors que rien du guidage ne change — seul le contenu de
 * l'écran bouge.
 *
 * Couvre : C6 (chaque échec du capteur a son état et son message), C7 (les
 * transitions produisent des annonces `aria-live`, jamais un écran muet),
 * C5 (l'abonnement GPS ne tourne que dans `guiding`).
 */

/**
 * Phase du guidage.
 *
 * - `idle` — rien en cours ; état initial et état d'arrivée du bouton « Arrêter »
 * - `guiding` — on suit la position et on avance dans les segments
 * - `paused` — l'usager a suspendu ; le capteur est relâché (C5), le trajet est gardé
 * - `signal-lost` — le capteur n'a plus rien à dire ; l'abonnement reste ouvert
 * - `arrived` — le but est atteint, le guidage s'arrête de lui-même
 */
export type NavigationPhase = 'idle' | 'guiding' | 'paused' | 'signal-lost' | 'arrived';

/** État complet d'une session de guidage — tout ce que l'écran a besoin de peindre. */
export interface NavigationState {
  phase: NavigationPhase;
  /** Itinéraire suivi, `null` hors session. */
  itinerary: Itinerary | null;
  /** Dernière position mesurée, `null` tant qu'aucune n'est arrivée. */
  position: UserPosition | null;
  /**
   * Progression calculée sur la dernière position.
   *
   * `null` avant la première mesure, **et** quand l'itinéraire ne porte aucun
   * tracé exploitable : l'écran doit alors dire qu'il ne peut pas guider plutôt
   * que d'afficher une progression inventée (voir `route-progress.ts`).
   */
  progress: RouteProgress | null;
  /** Cause du dernier échec du capteur, `null` si le signal est bon. */
  failure: GeolocationFailureReason | null;
}

/** Événements acceptés par le réducteur. */
export type NavigationEvent =
  /** Clic sur « Démarrer » : ouvre une session sur l'itinéraire retenu. */
  | { type: 'start'; itinerary: Itinerary }
  /** Nouvelle mesure du capteur. */
  | { type: 'position'; position: UserPosition }
  /** Échec du capteur remonté par l'abonnement. */
  | { type: 'signal-lost'; reason: GeolocationFailureReason }
  /** Suspension volontaire — relâche le GPS sans perdre le trajet. */
  | { type: 'pause' }
  /** Reprise après suspension. */
  | { type: 'resume' }
  /** Sortie du guidage, quelle que soit la phase. */
  | { type: 'stop' };

/** État de départ — aucune session, rien de mesuré. */
export const INITIAL_NAVIGATION_STATE: NavigationState = {
  phase: 'idle',
  itinerary: null,
  position: null,
  progress: null,
  failure: null,
};

/**
 * Applique un événement à l'état du guidage.
 *
 * ## Deux règles qui expliquent presque toutes les branches
 *
 * **Une position reçue vaut retour du signal.** `signal-lost` n'a pas besoin
 * d'un événement de réparation : la mesure qui arrive *est* la réparation. Le
 * tunnel se traverse donc sans que l'usager touche à quoi que ce soit
 * (recette 5), et c'est exactement pourquoi l'abonnement reste ouvert pendant
 * la perte de signal (voir `watchUserPosition`).
 *
 * **Une position reçue en pause ne fait rien.** L'abonnement est relâché quand
 * on suspend, mais une dernière mesure peut être déjà en vol. La laisser
 * avancer la progression ferait bouger un guidage que l'usager vient
 * explicitement d'arrêter.
 *
 * L'arrivée est terminale : seul `stop` en sort. Une mesure de plus après le
 * point d'arrivée — l'usager fait trois pas dans le hall — ne doit pas rouvrir
 * un guidage qui a abouti.
 *
 * @param state État courant
 * @param event Événement à appliquer
 * @returns Nouvel état ; l'état reçu n'est jamais modifié
 */
export function navigationReducer(state: NavigationState, event: NavigationEvent): NavigationState {
  switch (event.type) {
    case 'start':
      return {
        phase: 'guiding',
        itinerary: event.itinerary,
        // La position de la session précédente n'a rien à faire ici : elle
        // ferait afficher une progression sur un trajet qu'elle ne concerne pas.
        position: null,
        progress: null,
        failure: null,
      };

    case 'position': {
      if (state.phase === 'idle' || state.phase === 'paused' || state.phase === 'arrived') {
        return state;
      }
      if (!state.itinerary) return state;

      const progress = computeRouteProgress(state.itinerary, event.position);
      return {
        ...state,
        // Une mesure vaut retour du signal — voir la docstring.
        phase: progress?.arrived ? 'arrived' : 'guiding',
        position: event.position,
        progress,
        failure: null,
      };
    }

    case 'signal-lost':
      // Hors guidage, un échec du capteur n'a personne à prévenir : la pause a
      // relâché l'abonnement, et une session terminée n'attend plus rien.
      if (state.phase !== 'guiding') return state;
      return { ...state, phase: 'signal-lost', failure: event.reason };

    case 'pause':
      if (state.phase !== 'guiding' && state.phase !== 'signal-lost') return state;
      return { ...state, phase: 'paused' };

    case 'resume':
      if (state.phase !== 'paused') return state;
      // `failure` est effacé : on repart d'un capteur qu'on n'a pas encore
      // interrogé, pas d'un échec vieux de plusieurs minutes.
      return { ...state, phase: 'guiding', failure: null };

    case 'stop':
      return INITIAL_NAVIGATION_STATE;
  }
}

/**
 * Le guidage a-t-il besoin du capteur dans cette phase ? (C5)
 *
 * C'est cette fonction, et non le composant, qui décide quand le GPS tourne :
 * l'abonnement haute précision est ce que l'application fait de plus coûteux en
 * batterie, et le laisser ouvert pendant une pause ou après l'arrivée serait
 * exactement le « polling inutile » que la contrainte proscrit.
 */
export function needsPositionWatch(phase: NavigationPhase): boolean {
  // `signal-lost` en fait partie : c'est précisément la phase où l'on attend
  // que le capteur reparle.
  return phase === 'guiding' || phase === 'signal-lost';
}

/** Étape du fil de progression affiché sous le titre, façon « ✓ › 11 min › 6 › 2 ». */
export interface GuidanceStep {
  /** Identité stable dans la liste — l'index d'origine suffit, l'ordre ne bouge pas. */
  key: string;
  /** Pictogramme du mode, à poser en `aria-hidden` (doublé par `label`). */
  icon: string;
  /** Couleur du mode, identique à celle de son tracé sur la carte. */
  color: string;
  /** Libellé écrit du mode (« Vélo », « Bus ») — porte l'information, pas l'icône. */
  label: string;
  /** `'done' | 'current' | 'upcoming'` — pilote la pastille et l'annonce vocale. */
  status: 'done' | 'current' | 'upcoming';
  /** Durée à afficher : le **reste** sur l'étape en cours, la durée entière sinon. */
  minutes: number;
}

/**
 * Fil des étapes de l'itinéraire, avec celle qui est en cours (maquette
 * « 6. NAVIGATION », rangée de pastilles sous le titre).
 *
 * Les étapes franchies portent un état `done` et non leur durée : ce qui est
 * fait n'a plus à être compté, et la maquette y met d'ailleurs un « ✓ ». Celle
 * en cours porte le **reste**, pas la durée totale — c'est le seul chiffre qui
 * réponde à la question qu'on se pose en marchant.
 *
 * @param state État du guidage
 * @returns Étapes dans l'ordre du trajet ; tableau vide hors session
 */
export function guidanceSteps(state: NavigationState): GuidanceStep[] {
  if (!state.itinerary) return [];
  const currentIndex = state.progress?.segmentIndex ?? 0;

  return state.itinerary.segments.map((segment, index) => {
    const style = MODE_TRACK_STYLES[segment.mode];
    const status = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
    return {
      key: `${index}-${segment.mode}`,
      icon: MODE_ICONS[segment.mode],
      color: style.color,
      label: style.label,
      status,
      minutes:
        status === 'current' && state.progress
          ? Math.max(0, Math.round(state.progress.segmentRemainingMinutes))
          : segment.durationMinutes,
    };
  });
}

/**
 * Titre du panneau — « Encore 11 min à vélo » sur la maquette.
 *
 * Le reste est arrondi à la minute **supérieure** tant qu'il n'est pas nul :
 * annoncer « encore 0 min » à quelqu'un qui a encore une rue à faire est faux,
 * et « moins d'une minute » est ce qu'on dit dans ce cas.
 */
export function guidanceHeadline(state: NavigationState): string {
  switch (state.phase) {
    case 'idle':
      return 'Guidage arrêté';
    case 'arrived':
      return 'Vous êtes arrivé';
    case 'signal-lost':
      return 'Signal perdu';
    case 'paused':
      return 'Guidage en pause';
    case 'guiding':
      break;
  }

  if (!state.progress) return 'Recherche de votre position…';

  const minutes = state.progress.segmentRemainingMinutes;
  const label = MODE_TRACK_STYLES[state.progress.segment.mode].label.toLowerCase();
  if (minutes < 1) return `Moins d'une minute en ${label}`;
  return `Encore ${Math.ceil(minutes)} min en ${label}`;
}

/**
 * Segment qui suit celui en cours, ou `null` si l'on est sur le dernier.
 * Extrait ici pour que la sous-titre et son test parlent de la même chose.
 */
function nextSegment(state: NavigationState): RouteSegment | null {
  if (!state.itinerary || !state.progress) return null;
  return state.itinerary.segments[state.progress.segmentIndex + 1] ?? null;
}

/**
 * Sous-titre du panneau — « Puis bus C3 — passe dans 4 min » sur la maquette.
 *
 * ## Le « passe dans 4 min » n'est pas inventé
 *
 * Il est lu sur `RouteSegment.departureAt`, que la source GTFS horodate pour
 * les segments de transport en commun (UF-404). Un tronçon vélo ou une marche
 * n'en portent pas — ils n'ont pas d'horaire propre — et le sous-titre se
 * réduit alors à « Puis 11 min à vélo ». Fabriquer une heure de passage pour
 * un vélo ferait passer une estimation pour une donnée de réseau (C9).
 *
 * @param state État du guidage
 * @param now Instant de référence, injecté pour rendre la fonction testable
 */
export function guidanceSubline(state: NavigationState, now: Date = new Date()): string | null {
  if (state.phase === 'arrived') return 'Le trajet est terminé. Bonne journée !';
  if (state.phase === 'signal-lost' && state.failure) {
    return GEOLOCATION_ERROR_MESSAGES[state.failure];
  }
  if (state.phase !== 'guiding') return null;

  const next = nextSegment(state);
  if (!next) return state.progress ? "Dernière étape avant l'arrivée." : null;

  const style = MODE_TRACK_STYLES[next.mode];
  const name = next.line ? `${style.label.toLowerCase()} ${next.line}` : style.label.toLowerCase();

  if (!next.departureAt) return `Puis ${next.durationMinutes} min en ${name}.`;

  const departure = new Date(next.departureAt);
  if (Number.isNaN(departure.getTime())) return `Puis ${next.durationMinutes} min en ${name}.`;

  const inMinutes = Math.round((departure.getTime() - now.getTime()) / 60_000);
  if (inMinutes < 0) return `Puis ${name} — départ dépassé, la correspondance est à revoir.`;
  if (inMinutes === 0) return `Puis ${name} — passe maintenant.`;
  return `Puis ${name} — passe dans ${inMinutes} min.`;
}

/**
 * Heure d'arrivée estimée, « 10:03 » sur la maquette, ou `null` hors guidage.
 *
 * Recalculée à chaque mesure à partir du reste, et **non** reprise de
 * `Itinerary.arrivalAt` : cette dernière est l'arrivée prévue au moment du
 * calcul, elle ne bouge pas quand l'usager traîne. Une heure d'arrivée qui
 * n'avance jamais est pire que pas d'heure du tout.
 *
 * @param state État du guidage
 * @param now Instant de référence, injecté pour rendre la fonction testable
 */
export function estimatedArrival(state: NavigationState, now: Date = new Date()): string | null {
  if (state.phase !== 'guiding' || !state.progress) return null;
  const arrival = new Date(now.getTime() + state.progress.totalRemainingMinutes * 60_000);
  return arrival.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Phrase annoncée aux technologies d'assistance à chaque changement d'état (C7).
 *
 * Une région `aria-live` a besoin d'une phrase **complète et autonome** : un
 * lecteur d'écran annonce ce qui change, sans le contexte visuel qui l'entoure.
 * « Encore 11 min » seul ne dit ni de quoi ni où l'on en est — d'où la reprise
 * du mode, de l'étape et du rang.
 */
export function guidanceAnnouncement(state: NavigationState): string {
  if (state.phase === 'arrived') return 'Vous êtes arrivé à destination. Le guidage est terminé.';
  if (state.phase === 'paused') return 'Guidage en pause. Votre position n’est plus suivie.';
  if (state.phase === 'signal-lost' && state.failure) {
    return `Signal perdu. ${GEOLOCATION_ERROR_MESSAGES[state.failure]}`;
  }
  if (state.phase !== 'guiding' || !state.progress || !state.itinerary) return '';

  const total = state.itinerary.segments.length;
  const step = state.progress.segmentIndex + 1;
  const mode = MODE_TRACK_STYLES[state.progress.segment.mode].label.toLowerCase();
  const remaining = Math.max(1, Math.ceil(state.progress.segmentRemainingMinutes));

  const offRoute = state.progress.offRoute
    ? ` Vous semblez éloigné de l’itinéraire d’environ ${Math.round(state.progress.offRouteMeters)} mètres.`
    : '';

  return `Étape ${step} sur ${total}, en ${mode}. Encore ${remaining} minute${remaining > 1 ? 's' : ''} sur cette étape.${offRoute}`;
}
