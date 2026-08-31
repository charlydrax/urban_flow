import { TransportMode, type Itinerary, type RouteSegment } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import {
  HIGHLIGHT_LABELS,
  ITINERARY_VIEWS,
  MODE_ICONS,
  applyItineraryView,
  describeItinerary,
  describeItineraryView,
  fareCount,
  formatClock,
  itineraryClock,
  itineraryHighlights,
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

  it('annonce la mise en avant, que les badges ne disent qu’en couleur (UF-503)', () => {
    const description = describeItinerary(
      itinerary([segment(TransportMode.BIKE, 28)], { durationMinutes: 28, carbonGrams: 0 }),
      3,
      4,
      { greenest: true, fastest: false },
    );

    expect(description).toBe(
      'Option 3 sur 4. Choix vert · empreinte la plus faible. 28 minutes. Vélo 28 min. 0 g CO₂.',
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

  /**
   * UF-504 : la pastille CO₂ ne dit son niveau qu'en teinte et en pictogramme.
   * Sans cette reprise écrite, « c'est une option à faible empreinte » ne
   * serait accessible qu'à l'œil (C7 — WCAG 1.4.1).
   */
  it('annonce le niveau d’empreinte et sa comparaison voiture (UF-504)', () => {
    const description = describeItinerary(
      itinerary([segment(TransportMode.BIKE, 28)], {
        durationMinutes: 28,
        carbonGrams: 20,
        carbon: {
          totalGrams: 20,
          segments: [
            {
              mode: TransportMode.BIKE,
              distanceMeters: 10_000,
              factorGramsPerKm: 2,
              grams: 20,
            },
          ],
          carEquivalentGrams: 2180,
          avoidedGrams: 2160,
        },
      }),
      1,
      2,
    );

    expect(description).toBe(
      'Option 1 sur 2. 28 minutes. Vélo 28 min. ' +
        'Très faible empreinte, 20 g CO₂, −99 % vs voiture.',
    );
  });
});

describe('itineraryHighlights', () => {
  // Trois options qui ne se classent pas dans le même ordre selon le critère :
  // c'est exactement la situation que le ticket veut rendre lisible.
  const velo = itinerary([segment(TransportMode.BIKE, 28)], {
    id: 'velo',
    durationMinutes: 28,
    carbonGrams: 0,
  });
  const metro = itinerary([segment(TransportMode.METRO, 18)], {
    id: 'metro',
    durationMinutes: 18,
    carbonGrams: 120,
  });
  const bus = itinerary([segment(TransportMode.BUS, 22)], {
    id: 'bus',
    durationMinutes: 22,
    carbonGrams: 310,
  });

  it('désigne le moins émetteur, quel que soit son rang dans la liste', () => {
    // Liste classée par durée : le vélo est dernier, il reste le choix vert.
    const highlights = itineraryHighlights([metro, bus, velo]);

    expect(highlights['velo']?.greenest).toBe(true);
    expect(highlights['metro']?.greenest).toBeFalsy();
    expect(highlights['bus']).toBeUndefined();
  });

  it('désigne aussi le plus rapide — les deux badges coexistent', () => {
    const highlights = itineraryHighlights([velo, metro, bus]);

    expect(highlights['metro']?.fastest).toBe(true);
    expect(highlights['velo']?.fastest).toBeFalsy();
  });

  it('pose les deux badges sur le même itinéraire quand il gagne sur les deux', () => {
    const imbattable = itinerary([segment(TransportMode.BIKE, 9)], {
      id: 'imbattable',
      durationMinutes: 9,
      carbonGrams: 0,
    });

    expect(itineraryHighlights([imbattable, metro])['imbattable']).toEqual({
      greenest: true,
      fastest: true,
    });
  });

  it('ne badge qu’un seul ex æquo — deux « choix vert » ne mettent plus rien en avant', () => {
    const autreVelo = { ...velo, id: 'velo-2' };
    const highlights = itineraryHighlights([velo, autreVelo]);

    expect(highlights['velo']?.greenest).toBe(true);
    expect(highlights['velo-2']).toBeUndefined();
  });

  it('rend un objet vide sur une liste vide', () => {
    expect(itineraryHighlights([])).toEqual({});
  });
});

describe('applyItineraryView', () => {
  const rapideEtSale = itinerary([segment(TransportMode.BUS, 12, { line: 'C3' })], {
    id: 'rapide',
    durationMinutes: 12,
    carbonGrams: 400,
  });
  const lentEtPropre = itinerary([segment(TransportMode.BIKE, 30)], {
    id: 'propre',
    durationMinutes: 30,
    carbonGrams: 0,
  });

  it('rend la liste dans l’ordre du serveur sur la vue « Tous »', () => {
    // C'est le point de la vue par défaut : elle n'affirme rien que le serveur
    // n'ait fait, et ne réordonne donc rien.
    const shown = applyItineraryView([rapideEtSale, lentEtPropre], 'all');

    expect(shown.map((option) => option.id)).toEqual(['rapide', 'propre']);
  });

  it('classe par empreinte croissante sur la vue « Écolo »', () => {
    const shown = applyItineraryView([rapideEtSale, lentEtPropre], 'carbonAsc');

    expect(shown.map((option) => option.id)).toEqual(['propre', 'rapide']);
  });

  it('classe par durée croissante sur la vue « Rapide »', () => {
    const shown = applyItineraryView([lentEtPropre, rapideEtSale], 'durationAsc');

    expect(shown.map((option) => option.id)).toEqual(['rapide', 'propre']);
  });

  it('classe par nombre de titres croissant sur la vue « Économe »', () => {
    // Le vélo en libre-service coûte un titre, le bus aussi ; c'est la marche
    // seule qui n'en coûte aucun — et c'est elle que « Économe » remonte.
    const aPied = itinerary([segment(TransportMode.WALK, 25)], {
      id: 'marche',
      durationMinutes: 25,
      carbonGrams: 0,
    });
    const shown = applyItineraryView([rapideEtSale, aPied], 'fareAsc');

    expect(shown.map((option) => option.id)).toEqual(['marche', 'rapide']);
  });

  it('départage les ex æquo sur l’autre critère, comme le serveur', () => {
    // Même empreinte : sans second critère, l'ordre dépendrait de la stabilité
    // du `sort` du moteur — donc du hasard.
    const lourd = { ...lentEtPropre, id: 'lourd', durationMinutes: 40, carbonGrams: 400 };
    const shown = applyItineraryView([lourd, rapideEtSale], 'carbonAsc');

    expect(shown.map((option) => option.id)).toEqual(['rapide', 'lourd']);
  });

  it('ne modifie jamais la liste reçue — l’état React ne se mute pas', () => {
    const received = [rapideEtSale, lentEtPropre];

    for (const view of ITINERARY_VIEWS) {
      const shown = applyItineraryView(received, view.key);
      expect(shown).not.toBe(received);
    }
    expect(received.map((option) => option.id)).toEqual(['rapide', 'propre']);
  });

  it('ne retire aucun itinéraire, quelle que soit la vue', () => {
    // Les quatre pastilles réordonnent ; aucune ne filtre. Cacher des options
    // derrière un « filtre » ferait disparaître de l'écran des trajets que le
    // serveur juge pertinents, sans le dire.
    for (const view of ITINERARY_VIEWS) {
      expect(applyItineraryView([rapideEtSale, lentEtPropre], view.key)).toHaveLength(2);
    }
  });
});

describe('fareCount', () => {
  it('ne compte pas la marche', () => {
    expect(fareCount(itinerary([segment(TransportMode.WALK, 25)]))).toBe(0);
  });

  it('compte un titre par service, pas un par segment', () => {
    // Un métro B repris après un changement de quai reste un ticket.
    const memeLigne = itinerary([
      segment(TransportMode.METRO, 4, { line: 'B' }),
      segment(TransportMode.WALK, 2),
      segment(TransportMode.METRO, 6, { line: 'B' }),
    ]);

    expect(fareCount(memeLigne)).toBe(1);
  });

  it('compte deux titres pour deux lignes différentes', () => {
    const correspondance = itinerary([
      segment(TransportMode.BUS, 6, { line: 'C3' }),
      segment(TransportMode.BUS, 8, { line: 'C9' }),
    ]);

    expect(fareCount(correspondance)).toBe(2);
  });

  it('compte le vélo en libre-service, qui n’a pas de ligne', () => {
    expect(fareCount(itinerary([segment(TransportMode.BIKE, 12)]))).toBe(1);
  });
});

describe('ITINERARY_VIEWS', () => {
  it('reprend les quatre pastilles de la planche, dans son ordre (UF-804)', () => {
    expect(ITINERARY_VIEWS.map((view) => view.label)).toEqual([
      'Tous',
      'Rapide',
      'Écolo',
      'Économe',
    ]);
  });

  it('ouvre sur « Tous » — la seule vue qui n’affirme rien', () => {
    expect(ITINERARY_VIEWS[0]!.key).toBe('all');
  });

  it('décrit chaque vue en clair, sans jargon de clé de tri', () => {
    for (const view of ITINERARY_VIEWS) {
      expect(view.description).not.toMatch(/Asc|carbonGrams|durationMinutes/);
      expect(view.description.length).toBeGreaterThan(10);
    }
  });
});

describe('describeItineraryView', () => {
  it('reprend le tri du serveur sur la vue « Tous »', () => {
    // Sans cette reprise, un usager resté sur « Tous » n'aurait aucun moyen de
    // savoir sur quel critère sa liste est classée.
    expect(describeItineraryView('all', 'durationAsc')).toMatch(/durée/i);
    expect(describeItineraryView('all', 'carbonAsc')).toMatch(/empreinte/i);
  });

  it('reste lisible avant la première réponse, quand `sortedBy` est inconnu', () => {
    expect(describeItineraryView('all', null)).toMatch(/UrbanFlow/);
  });

  it('décrit la vue elle-même dès qu’elle réordonne', () => {
    expect(describeItineraryView('fareAsc', 'carbonAsc')).toMatch(/titres de transport/i);
  });
});

describe('HIGHLIGHT_LABELS', () => {
  it('dit « choix vert » et dit pourquoi', () => {
    expect(HIGHLIGHT_LABELS.greenest).toContain('Choix vert');
    expect(HIGHLIGHT_LABELS.greenest).toContain('empreinte');
    expect(HIGHLIGHT_LABELS.fastest).toContain('rapide');
  });
});
