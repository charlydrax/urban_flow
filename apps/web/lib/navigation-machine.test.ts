import { TransportMode, type Itinerary, type RouteSegment } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import type { UserPosition } from './geolocation';
import {
  INITIAL_NAVIGATION_STATE,
  estimatedArrival,
  guidanceAnnouncement,
  guidanceHeadline,
  guidanceSteps,
  guidanceSubline,
  navigationReducer,
  needsPositionWatch,
  type NavigationEvent,
  type NavigationState,
} from './navigation-machine';

const LAT = 45.76;

function at(lng: number, lat = LAT): UserPosition {
  return { lat, lng, accuracyMeters: 12 };
}

function segment(
  mode: TransportMode,
  durationMinutes: number,
  coordinates: [number, number][],
  extra: Partial<RouteSegment> = {},
): RouteSegment {
  return {
    mode,
    from: 'A',
    to: 'B',
    durationMinutes,
    distanceMeters: 1000,
    carbonGrams: 0,
    geometry: { type: 'LineString', coordinates },
    ...extra,
  };
}

/** Vélo de 4,850 à 4,852, puis bus C3 de 4,852 à 4,856. */
const TRIP: Itinerary = {
  id: 'itin-1',
  summary: 'Vélo + Bus C3',
  durationMinutes: 16,
  distanceMeters: 2000,
  carbonGrams: 240,
  accessible: false,
  segments: [
    segment(TransportMode.BIKE, 10, [
      [4.85, LAT],
      [4.852, LAT],
    ]),
    segment(TransportMode.BUS, 6, [
      [4.852, LAT],
      [4.856, LAT],
    ]),
  ],
};

/** Rejoue une suite d'événements depuis l'état initial. */
function run(...events: NavigationEvent[]): NavigationState {
  return events.reduce(navigationReducer, INITIAL_NAVIGATION_STATE);
}

const START: NavigationEvent = { type: 'start', itinerary: TRIP };

describe('navigationReducer — cycle de vie', () => {
  it('part de idle et n’en sort que sur « Démarrer »', () => {
    expect(INITIAL_NAVIGATION_STATE.phase).toBe('idle');
    expect(run({ type: 'position', position: at(4.851) }).phase).toBe('idle');
    expect(run({ type: 'pause' }).phase).toBe('idle');
    expect(run(START).phase).toBe('guiding');
  });

  it('n’a aucune progression tant qu’aucune position n’est arrivée', () => {
    const state = run(START);

    expect(state.itinerary).toBe(TRIP);
    expect(state.position).toBeNull();
    expect(state.progress).toBeNull();
  });

  it('avance de segment en segment jusqu’à l’arrivée (recette 3)', () => {
    let state = run(START);
    const seen: (number | null)[] = [];

    for (const lng of [4.8505, 4.8515, 4.853, 4.855, 4.856]) {
      state = navigationReducer(state, { type: 'position', position: at(lng) });
      seen.push(state.progress?.segmentIndex ?? null);
    }

    expect(seen).toEqual([0, 0, 1, 1, 1]);
    expect(state.phase).toBe('arrived');
  });

  it('l’arrivée est terminale : une mesure de plus ne rouvre pas le guidage', () => {
    const arrived = run(START, { type: 'position', position: at(4.856) });
    const after = navigationReducer(arrived, { type: 'position', position: at(4.851) });

    expect(arrived.phase).toBe('arrived');
    expect(after).toBe(arrived);
  });

  it('« Arrêter » ramène à l’état initial depuis n’importe quelle phase', () => {
    for (const state of [
      run(START),
      run(START, { type: 'position', position: at(4.851) }),
      run(START, { type: 'pause' }),
      run(START, { type: 'signal-lost', reason: 'unavailable' }),
      run(START, { type: 'position', position: at(4.856) }),
    ]) {
      expect(navigationReducer(state, { type: 'stop' })).toEqual(INITIAL_NAVIGATION_STATE);
    }
  });

  it('ne réutilise pas la position de la session précédente au démarrage suivant', () => {
    const state = run(START, { type: 'position', position: at(4.851) }, { type: 'stop' }, START);

    expect(state.position).toBeNull();
    expect(state.progress).toBeNull();
  });
});

describe('navigationReducer — pause et reprise', () => {
  it('suspend puis reprend le guidage', () => {
    const paused = run(START, { type: 'position', position: at(4.851) }, { type: 'pause' });

    expect(paused.phase).toBe('paused');
    // Le trajet et la progression sont gardés : c'est une pause, pas un arrêt.
    expect(paused.itinerary).toBe(TRIP);
    expect(paused.progress).not.toBeNull();
    expect(navigationReducer(paused, { type: 'resume' }).phase).toBe('guiding');
  });

  it('ignore une mesure arrivée après la mise en pause', () => {
    const paused = run(START, { type: 'position', position: at(4.851) }, { type: 'pause' });
    const after = navigationReducer(paused, { type: 'position', position: at(4.855) });

    expect(after).toBe(paused);
    expect(after.progress!.segmentIndex).toBe(0);
  });

  it('ne relâche le capteur qu’en pause, à l’arrêt et à l’arrivée (C5)', () => {
    expect(needsPositionWatch('guiding')).toBe(true);
    // On attend précisément que le capteur reparle : l'abonnement reste ouvert.
    expect(needsPositionWatch('signal-lost')).toBe(true);
    expect(needsPositionWatch('paused')).toBe(false);
    expect(needsPositionWatch('idle')).toBe(false);
    expect(needsPositionWatch('arrived')).toBe(false);
  });
});

describe('navigationReducer — perte de signal (recette 5)', () => {
  it('bascule en signal-lost en gardant le trajet et la dernière progression', () => {
    const lost = run(
      START,
      { type: 'position', position: at(4.851) },
      { type: 'signal-lost', reason: 'timeout' },
    );

    expect(lost.phase).toBe('signal-lost');
    expect(lost.failure).toBe('timeout');
    expect(lost.itinerary).toBe(TRIP);
    // Ce qu'on savait reste affiché : perdre le signal n'efface pas le trajet.
    expect(lost.progress!.segmentIndex).toBe(0);
  });

  it('repart tout seul dès qu’une mesure revient, sans geste de l’usager', () => {
    const back = run(
      START,
      { type: 'position', position: at(4.851) },
      { type: 'signal-lost', reason: 'unavailable' },
      { type: 'position', position: at(4.8535) },
    );

    expect(back.phase).toBe('guiding');
    expect(back.failure).toBeNull();
    expect(back.progress!.segmentIndex).toBe(1);
  });

  it('n’enregistre pas un échec du capteur hors guidage', () => {
    const paused = run(START, { type: 'pause' });

    expect(navigationReducer(paused, { type: 'signal-lost', reason: 'denied' })).toBe(paused);
  });

  it('repart d’un capteur neuf après une reprise, sans traîner l’ancien échec', () => {
    const resumed = run(
      START,
      { type: 'signal-lost', reason: 'timeout' },
      { type: 'pause' },
      { type: 'resume' },
    );

    expect(resumed.phase).toBe('guiding');
    expect(resumed.failure).toBeNull();
  });
});

describe('libellés du panneau de guidage', () => {
  const guiding = run(START, { type: 'position', position: at(4.851) });

  it('titre le reste du segment en cours, comme sur la maquette', () => {
    expect(guidanceHeadline(guiding)).toBe('Encore 5 min en vélo');
  });

  it('ne dit jamais « encore 0 min » à quelqu’un qui n’est pas arrivé', () => {
    // Juste avant la fin du segment vélo : le reste arrondit à zéro minute.
    const almost = run(START, { type: 'position', position: at(4.85199) });

    expect(almost.phase).toBe('guiding');
    expect(guidanceHeadline(almost)).toBe("Moins d'une minute en vélo");
  });

  it('a un titre pour chaque phase', () => {
    expect(guidanceHeadline(INITIAL_NAVIGATION_STATE)).toBe('Guidage arrêté');
    expect(guidanceHeadline(run(START, { type: 'pause' }))).toBe('Guidage en pause');
    expect(guidanceHeadline(run(START, { type: 'signal-lost', reason: 'timeout' }))).toBe(
      'Signal perdu',
    );
    expect(guidanceHeadline(run(START, { type: 'position', position: at(4.856) }))).toBe(
      'Vous êtes arrivé',
    );
  });

  it('annonce la suite sans horaire quand la source n’en publie pas', () => {
    expect(guidanceSubline(guiding)).toBe('Puis 6 min en bus.');
  });

  it('lit le « passe dans 4 min » sur departureAt, il ne l’invente pas', () => {
    const now = new Date('2026-09-01T10:00:00+02:00');
    const withSchedule: Itinerary = {
      ...TRIP,
      segments: [
        TRIP.segments[0],
        { ...TRIP.segments[1], line: 'C3', departureAt: '2026-09-01T10:04:00+02:00' },
      ],
    };
    const state = run(
      { type: 'start', itinerary: withSchedule },
      { type: 'position', position: at(4.851) },
    );

    expect(guidanceSubline(state, now)).toBe('Puis bus C3 — passe dans 4 min.');
  });

  it('dit la correspondance dépassée plutôt que d’afficher un délai négatif', () => {
    const now = new Date('2026-09-01T10:10:00+02:00');
    const withSchedule: Itinerary = {
      ...TRIP,
      segments: [
        TRIP.segments[0],
        { ...TRIP.segments[1], line: 'C3', departureAt: '2026-09-01T10:04:00+02:00' },
      ],
    };
    const state = run(
      { type: 'start', itinerary: withSchedule },
      { type: 'position', position: at(4.851) },
    );

    expect(guidanceSubline(state, now)).toContain('départ dépassé');
  });

  it('annonce la dernière étape quand plus aucun segment ne suit', () => {
    const onLast = run(START, { type: 'position', position: at(4.853) });

    expect(guidanceSubline(onLast)).toBe("Dernière étape avant l'arrivée.");
  });

  it('reprend le message normalisé du capteur en perte de signal', () => {
    const lost = run(START, { type: 'signal-lost', reason: 'denied' });

    expect(guidanceSubline(lost)).toContain('refusé la géolocalisation');
  });

  it('recalcule l’heure d’arrivée depuis le reste, pas depuis arrivalAt', () => {
    const now = new Date('2026-09-01T10:00:00+02:00');

    // 11 min restantes (5 de vélo + 6 de bus) → 10:11, quelle que soit l'heure
    // d'arrivée que le serveur avait calculée au moment de la recherche.
    expect(estimatedArrival(guiding, now)).toBe('10:11');
    expect(estimatedArrival(INITIAL_NAVIGATION_STATE, now)).toBeNull();
    expect(estimatedArrival(run(START, { type: 'pause' }), now)).toBeNull();
  });

  it('annonce l’heure du réseau, pas celle de l’appareil', () => {
    /*
      Le cas qui a fait tomber la CI : le runner GitHub est en UTC, mon poste
      en Europe/Paris, et un `toLocaleTimeString` sans fuseau explicite rendait
      « 08:11 » d'un côté et « 10:11 » de l'autre.

      Ce n'était pas qu'un test fragile : le panneau de guidage aurait affiché
      une autre heure que la carte de résultat du même trajet, qui passe elle
      par `formatClock` (UF-404). L'assertion vaut donc pour la règle produit —
      un poste resté à l'heure de Londres lit l'heure à laquelle on arrive à
      Lyon — et pas seulement pour la stabilité de la suite.
    */
    const parisNoon = new Date('2026-09-01T12:00:00+02:00');

    expect(estimatedArrival(guiding, parisNoon)).toBe('12:11');
    // Le même instant, écrit en UTC : la réponse ne doit pas changer.
    expect(estimatedArrival(guiding, new Date('2026-09-01T10:00:00Z'))).toBe('12:11');
  });
});

describe('guidanceSteps', () => {
  it('marque l’étape en cours, celles qui sont faites et celles qui restent', () => {
    const steps = guidanceSteps(run(START, { type: 'position', position: at(4.854) }));

    expect(steps.map((step) => step.status)).toEqual(['done', 'current']);
  });

  it('affiche le reste sur l’étape en cours et la durée entière sur les autres', () => {
    const steps = guidanceSteps(run(START, { type: 'position', position: at(4.851) }));

    expect(steps[0]).toMatchObject({ status: 'current', minutes: 5, label: 'Vélo' });
    expect(steps[1]).toMatchObject({ status: 'upcoming', minutes: 6, label: 'Bus' });
  });

  it('rend un tableau vide hors session', () => {
    expect(guidanceSteps(INITIAL_NAVIGATION_STATE)).toEqual([]);
  });
});

describe('guidanceAnnouncement (C7)', () => {
  it('situe l’étape dans le trajet, ce que le titre visuel ne fait pas', () => {
    const announcement = guidanceAnnouncement(
      run(START, { type: 'position', position: at(4.851) }),
    );

    expect(announcement).toBe('Étape 1 sur 2, en vélo. Encore 5 minutes sur cette étape.');
  });

  it('signale l’écart au tracé dans l’annonce', () => {
    const announcement = guidanceAnnouncement(
      run(START, { type: 'position', position: at(4.851, LAT + 0.002) }),
    );

    expect(announcement).toContain('éloigné de l’itinéraire');
  });

  it('annonce l’arrivée et la pause en toutes lettres', () => {
    expect(guidanceAnnouncement(run(START, { type: 'position', position: at(4.856) }))).toContain(
      'arrivé à destination',
    );
    expect(guidanceAnnouncement(run(START, { type: 'pause' }))).toContain('pause');
  });
});
