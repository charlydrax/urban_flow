import { TransportMode } from '../../../common/enums/transport-mode.enum';
import { decodePolyline, mapOtpMode, toTransitJourney, toTransitJourneys } from './otp.mapper';
import type { OtpItinerary, OtpLeg } from './otp.types';

/**
 * Recette UF-302 — « la réponse est normalisée au format interne (indépendant
 * de la structure OTP) ».
 *
 * Les fixtures reproduisent la forme réelle observée sur le graphe lyonnais :
 * horaires en millisecondes, durées en secondes, tracés en polyligne encodée.
 */

/** Segment de marche minimal, surchargeable champ par champ. */
function walkLeg(overrides: Partial<OtpLeg> = {}): OtpLeg {
  return {
    mode: 'WALK',
    startTime: 1652769134000, // 2022-05-17T06:32:14Z
    endTime: 1652769300000,
    duration: 166,
    distance: 214.03,
    transitLeg: false,
    legGeometry: { points: 'arhvGe`t\\?@BHN^' },
    route: null,
    trip: null,
    from: { name: 'Origin', lat: 45.760515, lon: 4.859057, stop: null },
    to: {
      name: 'Gare Part-Dieu V.Merle',
      lat: 45.760837,
      lon: 4.857902,
      stop: { gtfsId: 'tcl:46088', name: 'Gare Part-Dieu V.Merle', wheelchairBoarding: 'POSSIBLE' },
    },
    ...overrides,
  };
}

/** Segment de bus TCL, surchargeable champ par champ. */
function busLeg(overrides: Partial<OtpLeg> = {}): OtpLeg {
  return {
    mode: 'BUS',
    startTime: 1652769300000,
    endTime: 1652769960000,
    duration: 660,
    distance: 2169.76,
    transitLeg: true,
    headsign: 'Bellecour Le Viste',
    legGeometry: { points: 'ethvG{xs\\j@zg@' },
    route: {
      shortName: 'C9',
      longName: 'Hôpitaux Est --> Bellecour Le Viste',
      mode: 'BUS',
      agency: { name: 'TCL SYTRAL' },
    },
    trip: { tripHeadsign: 'Bellecour Le Viste', wheelchairAccessible: 'POSSIBLE' },
    from: {
      name: 'Gare Part-Dieu V.Merle',
      lat: 45.760837,
      lon: 4.857902,
      stop: { gtfsId: 'tcl:46088', name: 'Gare Part-Dieu V.Merle', wheelchairBoarding: 'POSSIBLE' },
    },
    to: {
      name: 'Bellecour Le Viste',
      lat: 45.7575919,
      lon: 4.8338879,
      stop: { gtfsId: 'tcl:12289', name: 'Bellecour Le Viste', wheelchairBoarding: 'POSSIBLE' },
    },
    ...overrides,
  };
}

/** Itinéraire marche + bus, celui du scénario Part-Dieu → Bellecour. */
function itinerary(overrides: Partial<OtpItinerary> = {}): OtpItinerary {
  return {
    duration: 1092,
    startTime: 1652769134000,
    endTime: 1652770226000,
    walkDistance: 522.04,
    legs: [walkLeg(), busLeg()],
    ...overrides,
  };
}

describe('mapOtpMode', () => {
  it('projette les modes du réseau lyonnais sur le vocabulaire interne', () => {
    expect(mapOtpMode('BUS')).toBe(TransportMode.BUS);
    expect(mapOtpMode('TRAM')).toBe(TransportMode.TRAM);
    expect(mapOtpMode('WALK')).toBe(TransportMode.WALK);
    // Le graphe TCL contient ces deux modes : ils ne doivent jamais être écartés.
    expect(mapOtpMode('SUBWAY')).toBe(TransportMode.METRO);
    expect(mapOtpMode('FUNICULAR')).toBe(TransportMode.METRO);
  });

  it('rejette un mode inconnu plutôt que de deviner', () => {
    // Deviner alimenterait le calcul carbone avec un facteur d'émission faux.
    expect(mapOtpMode('FERRY')).toBeNull();
    expect(mapOtpMode(null)).toBeNull();
    expect(mapOtpMode(undefined)).toBeNull();
  });
});

describe('decodePolyline', () => {
  it('décode une polyligne en coordonnées GeoJSON [lng, lat]', () => {
    // Exemple canonique de la spécification Google : trois points en Californie.
    const points = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');

    expect(points).toHaveLength(3);
    // L'ordre GeoJSON est [longitude, latitude] — l'inverse d'OTP (C9).
    expect(points[0][0]).toBeCloseTo(-120.2, 4);
    expect(points[0][1]).toBeCloseTo(38.5, 4);
    expect(points[2][0]).toBeCloseTo(-126.453, 3);
    expect(points[2][1]).toBeCloseTo(43.252, 3);
  });

  it('tolère une géométrie absente', () => {
    expect(decodePolyline(null)).toEqual([]);
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('toTransitJourney', () => {
  it('normalise un trajet marche + bus au format interne', () => {
    const journey = toTransitJourney(itinerary(), 0);

    expect(journey).not.toBeNull();
    expect(journey?.id).toBe('transit-1');
    expect(journey?.durationMinutes).toBe(18); // 1092 s
    expect(journey?.walkDistanceMeters).toBe(522);
    // Un seul segment TC : aucune correspondance.
    expect(journey?.transfers).toBe(0);
    // Les horaires sortent en ISO 8601, pas en millisecondes epoch.
    expect(journey?.departureAt).toBe('2022-05-17T06:32:14.000Z');
    expect(journey?.legs).toHaveLength(2);
  });

  it('expose la ligne, l’exploitant et l’arrêt GTFS du segment TC (C9)', () => {
    const journey = toTransitJourney(itinerary(), 0);
    const leg = journey?.legs[1];

    expect(leg?.mode).toBe(TransportMode.BUS);
    expect(leg?.sourceMode).toBe('BUS');
    expect(leg?.transit).toBe(true);
    expect(leg?.line).toBe('C9');
    expect(leg?.operator).toBe('TCL SYTRAL');
    expect(leg?.headsign).toBe('Bellecour Le Viste');
    expect(leg?.from.stopId).toBe('tcl:46088');
    expect(leg?.durationMinutes).toBe(11); // 660 s
    expect(leg?.distanceMeters).toBe(2170);
  });

  it('produit un tracé GeoJSON concaténant les segments (C9)', () => {
    const journey = toTransitJourney(itinerary(), 0);

    expect(journey?.geometry?.type).toBe('LineString');
    const walkPoints = decodePolyline(walkLeg().legGeometry?.points).length;
    const busPoints = decodePolyline(busLeg().legGeometry?.points).length;
    expect(journey?.geometry?.coordinates).toHaveLength(walkPoints + busPoints);
  });

  it('compte les correspondances entre segments TC', () => {
    const journey = toTransitJourney(
      itinerary({ legs: [walkLeg(), busLeg(), walkLeg(), busLeg(), walkLeg()] }),
      0,
    );

    expect(journey?.transfers).toBe(1);
  });

  describe('accessibilité PMR (C12)', () => {
    it('déclare accessible un trajet dont chaque maillon TC l’est', () => {
      expect(toTransitJourney(itinerary(), 0)?.accessible).toBe(true);
    });

    it('déclare inaccessible un trajet dont un arrêt ne l’est pas', () => {
      const inaccessible = busLeg({
        to: {
          name: 'Bellecour Le Viste',
          lat: 45.7575919,
          lon: 4.8338879,
          stop: {
            gtfsId: 'tcl:12289',
            name: 'Bellecour Le Viste',
            wheelchairBoarding: 'NOT_POSSIBLE',
          },
        },
      });

      const journey = toTransitJourney(itinerary({ legs: [walkLeg(), inaccessible] }), 0);
      expect(journey?.accessible).toBe(false);
    });

    it('traite une accessibilité non renseignée comme non accessible', () => {
      // Le doute doit profiter à la sécurité de l'usager, pas à l'optimisme.
      const unknown = busLeg({
        trip: { tripHeadsign: 'Bellecour Le Viste', wheelchairAccessible: 'NO_INFORMATION' },
      });

      const journey = toTransitJourney(itinerary({ legs: [walkLeg(), unknown] }), 0);
      expect(journey?.accessible).toBe(false);
    });
  });

  it('écarte un trajet contenant un mode sans correspondance', () => {
    const journey = toTransitJourney(
      itinerary({ legs: [walkLeg(), busLeg({ mode: 'FERRY' })] }),
      0,
    );

    expect(journey).toBeNull();
  });

  it('écarte un itinéraire sans segment', () => {
    expect(toTransitJourney(itinerary({ legs: [] }), 0)).toBeNull();
  });

  it('survit à un GTFS incomplet (ni ligne, ni exploitant, ni tracé)', () => {
    const bare = busLeg({
      headsign: null,
      route: null,
      trip: null,
      legGeometry: null,
    });

    const journey = toTransitJourney(itinerary({ legs: [bare], walkDistance: null }), 0);

    expect(journey).not.toBeNull();
    expect(journey?.legs[0].line).toBeUndefined();
    expect(journey?.legs[0].operator).toBeUndefined();
    expect(journey?.legs[0].geometry).toBeUndefined();
    expect(journey?.walkDistanceMeters).toBe(0);
  });
});

describe('toTransitJourneys', () => {
  it('numérote les trajets et ignore les entrées inexploitables', () => {
    const journeys = toTransitJourneys([itinerary(), null, itinerary()]);

    // Le trajet `null` est écarté, mais l'index d'origine reste la source de
    // l'identifiant : deux trajets distincts ne peuvent pas porter le même id.
    expect(journeys.map((journey) => journey.id)).toEqual(['transit-1', 'transit-3']);
  });

  it('rend une liste vide quand le moteur ne propose rien', () => {
    expect(toTransitJourneys(null)).toEqual([]);
    expect(toTransitJourneys([])).toEqual([]);
  });
});
