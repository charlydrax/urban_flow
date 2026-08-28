import { TransportMode, type Itinerary, type RouteSegment } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import {
  BEST_OPTION_REASON,
  MODE_ICONS,
  describeItinerary,
  formatClock,
  itineraryClock,
  modeSequence,
} from './itinerary-cards';
import { MODE_TRACK_STYLES } from './route-map-layers';

function segment(
  mode: TransportMode,
  durationMinutes: number,
  extra: Partial<RouteSegment> = {},
): RouteSegment {
  return {
    mode,
    from: 'A',
    to: 'B',
    durationMinutes,
    distanceMeters: durationMinutes * 80,
    carbonGrams: 0,
    ...extra,
  };
}

function itinerary(segments: RouteSegment[], extra: Partial<Itinerary> = {}): Itinerary {
  return {
    id: 'itin-1',
    summary: 'Marche + Bus C3',
    durationMinutes: segments.reduce((total, s) => total + s.durationMinutes, 0),
    distanceMeters: 4200,
    carbonGrams: 240,
    accessible: false,
    segments,
    ...extra,
  };
}

describe('modeSequence', () => {
  it('rend une étape par segment, dans l’ordre du trajet', () => {
    const legs = modeSequence(
      itinerary([
        segment(TransportMode.WALK, 3),
        segment(TransportMode.BIKE, 11),
        segment(TransportMode.BUS, 6, { line: 'C3' }),
      ]),
    );

    expect(legs.map((leg) => [leg.mode, leg.durationMinutes])).toEqual([
      [TransportMode.WALK, 3],
      [TransportMode.BIKE, 11],
      [TransportMode.BUS, 6],
    ]);
    expect(legs[2]!.line).toBe('C3');
  });

  it('fusionne deux segments consécutifs de même mode et même ligne', () => {
    // Un changement de quai sur la même ligne : c'est un seul trajet, pas deux.
    const legs = modeSequence(
      itinerary([
        segment(TransportMode.METRO, 7, { line: 'B' }),
        segment(TransportMode.METRO, 5, { line: 'B' }),
      ]),
    );

    expect(legs).toHaveLength(1);
    expect(legs[0]!.durationMinutes).toBe(12);
  });

  it('garde deux étapes distinctes pour deux lignes différentes du même mode', () => {
    // Descendre du C3 pour monter dans le C13 est bien un changement de véhicule.
    const legs = modeSequence(
      itinerary([
        segment(TransportMode.BUS, 7, { line: 'C3' }),
        segment(TransportMode.BUS, 5, { line: 'C13' }),
      ]),
    );

    expect(legs.map((leg) => leg.line)).toEqual(['C3', 'C13']);
  });

  it('reprend la couleur du tracé de la carte, pas une nuance à part (UF-403)', () => {
    const legs = modeSequence(itinerary([segment(TransportMode.BUS, 6, { line: 'C3' })]));

    expect(legs[0]!.color).toBe(MODE_TRACK_STYLES[TransportMode.BUS].color);
    expect(legs[0]!.label).toBe(MODE_TRACK_STYLES[TransportMode.BUS].label);
  });

  it('couvre les sept modes de l’énumération partagée', () => {
    // Un mode ajouté sans pictogramme afficherait `undefined` dans la séquence.
    for (const mode of Object.values(TransportMode)) {
      expect(MODE_ICONS[mode]).toBeTruthy();
    }
  });

  it('rend une liste vide pour un itinéraire sans segment', () => {
    expect(modeSequence(itinerary([]))).toEqual([]);
  });
});

describe('formatClock', () => {
  it('affiche l’heure de quai du réseau, quel que soit le fuseau du poste', () => {
    // 09:47 à Lyon. Le même instant vaut 08:47 à Londres : c'est l'heure de
    // Lyon qui doit s'afficher, c'est elle qui est écrite sur le quai (C9).
    expect(formatClock('2026-08-28T09:47:00+02:00')).toBe('09:47');
    expect(formatClock('2026-08-28T07:47:00Z')).toBe('09:47');
  });

  it('rend null sur un horodatage absent ou illisible plutôt qu’« Invalid Date »', () => {
    expect(formatClock(undefined)).toBeNull();
    expect(formatClock('pas une date')).toBeNull();
  });
});

describe('itineraryClock', () => {
  it('rend le créneau quand la source a daté les deux bornes', () => {
    const clock = itineraryClock(
      itinerary([segment(TransportMode.BUS, 6, { line: 'C3' })], {
        departureAt: '2026-08-28T09:41:00+02:00',
        arrivalAt: '2026-08-28T10:03:00+02:00',
      }),
    );

    expect(clock).toEqual({ departure: '09:41', arrival: '10:03' });
  });

  it('rend null pour un itinéraire non daté — un tout-vélo part quand on veut', () => {
    expect(itineraryClock(itinerary([segment(TransportMode.BIKE, 28)]))).toBeNull();
  });

  it('rend null si une seule borne est datée', () => {
    // Annoncer « arrivée 10:03 » sans dire de quand on part serait trompeur.
    const partial = itinerary([segment(TransportMode.BUS, 6)], {
      arrivalAt: '2026-08-28T10:03:00+02:00',
    });

    expect(itineraryClock(partial)).toBeNull();
  });
});

describe('describeItinerary', () => {
  it('nomme les modes en toutes lettres, là où l’affichage montre des icônes', () => {
    const description = describeItinerary(
      itinerary(
        [
          segment(TransportMode.WALK, 3),
          segment(TransportMode.BUS, 6, { line: 'C3' }),
          segment(TransportMode.WALK, 2),
        ],
        {
          durationMinutes: 11,
          accessible: true,
          departureAt: '2026-08-28T09:41:00+02:00',
          arrivalAt: '2026-08-28T09:52:00+02:00',
        },
      ),
      1,
      3,
    );

    expect(description).toBe(
      'Option 1 sur 3. 11 minutes. Marche 3 min, puis Bus C3 6 min, puis Marche 2 min. ' +
        'départ 09:41, arrivée 09:52. 240 g CO₂. accessible en fauteuil roulant.',
    );
  });

  it('n’annonce ni horaire ni mention PMR quand la donnée est absente', () => {
    const description = describeItinerary(
      itinerary([segment(TransportMode.BIKE, 28)], { durationMinutes: 28, carbonGrams: 0 }),
      2,
      3,
    );

    expect(description).toBe('Option 2 sur 3. 28 minutes. Vélo 28 min. 0 g CO₂.');
  });
});

describe('BEST_OPTION_REASON', () => {
  it('formule la mise en tête à partir de la clé de tri publiée par le serveur', () => {
    // Le client n'invente pas le classement : il traduit `sortedBy`.
    expect(BEST_OPTION_REASON.durationAsc).toContain('rapide');
    expect(BEST_OPTION_REASON.carbonAsc).toContain('empreinte');
  });
});
