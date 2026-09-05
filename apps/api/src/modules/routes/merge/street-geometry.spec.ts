import type { Itinerary, LineStringGeometry, RouteSegment } from '@urbanflow/shared';

import { TransportMode } from '../../../common/enums/transport-mode.enum';
import { streetPathKey } from '../../transport/street-routing.service';
import { applyStreetGeometry, collectStreetPathQueries } from './street-geometry';

/**
 * Recette UF-702, volet « réinjection » :
 * - seuls les segments de voirie encore droits demandent un cheminement ;
 * - le tracé rendu remplace la droite et se raccorde aux extrémités déclarées ;
 * - un cheminement manquant laisse la droite en place, marquée comme telle ;
 * - la géométrie d'ensemble de l'itinéraire suit celle de ses segments.
 */

/**
 * Refuse un `undefined` plutôt que de l'assumer.
 *
 * Le lint interdit `!` (C3), et c'est une bonne chose jusque dans les tests :
 * un `undefined` inattendu doit dire *ce qui* manquait, pas produire un
 * « Cannot read properties of undefined » cinq lignes plus loin.
 */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test mal formé : ${what} manquant.`);
  return value;
}

const START: [number, number] = [4.85906, 45.76052];
const MIDDLE: [number, number] = [4.857, 45.7599];
const END: [number, number] = [4.85495, 45.75899];

/** Segment tel que la fusion le produit : une droite entre deux points. */
function straightSegment(mode: TransportMode, from = START, to = MIDDLE): RouteSegment {
  return {
    mode,
    from: 'Part-Dieu',
    to: 'Vélo’v Garibaldi',
    durationMinutes: 4,
    distanceMeters: 300,
    carbonGrams: 0,
    geometry: { type: 'LineString', coordinates: [from, to] },
    geometrySource: 'straight',
  };
}

function itineraryOf(...segments: RouteSegment[]): Itinerary {
  return {
    id: 'bike',
    summary: 'Marche + Vélo',
    durationMinutes: 12,
    distanceMeters: 1800,
    carbonGrams: 0,
    accessible: false,
    segments,
    geometry: {
      type: 'LineString',
      coordinates: segments.flatMap((segment) => segment.geometry?.coordinates ?? []),
    },
  };
}

/** Un cheminement qui suit les rues entre {@link START} et {@link MIDDLE}. */
const ROUTED: LineStringGeometry = {
  type: 'LineString',
  coordinates: [
    [4.85905, 45.76051],
    [4.8586, 45.7602],
    [4.8578, 45.76001],
    [4.85702, 45.75991],
  ],
};

describe('collectStreetPathQueries', () => {
  it('demande un cheminement pour la marche, le vélo et la trottinette', () => {
    const itinerary = itineraryOf(
      straightSegment(TransportMode.WALK),
      straightSegment(TransportMode.BIKE, MIDDLE, END),
      straightSegment(TransportMode.SCOOTER, MIDDLE, END),
    );

    expect(collectStreetPathQueries([itinerary], false).map((query) => query.mode)).toEqual([
      TransportMode.WALK,
      TransportMode.BIKE,
      TransportMode.SCOOTER,
    ]);
  });

  it("n'en demande aucun pour un segment de transport en commun (sa forme vient du GTFS)", () => {
    const itinerary = itineraryOf(straightSegment(TransportMode.METRO));

    expect(collectStreetPathQueries([itinerary], false)).toEqual([]);
  });

  it("n'en demande aucun pour un segment déjà routé — ce serait payer pour la même réponse (C5)", () => {
    const routed: RouteSegment = {
      ...straightSegment(TransportMode.WALK),
      geometrySource: 'routed',
    };

    expect(collectStreetPathQueries([itineraryOf(routed)], false)).toEqual([]);
  });

  it('lit les extrémités dans le tracé du segment, faute de champ dédié au contrat', () => {
    const [query] = collectStreetPathQueries(
      [itineraryOf(straightSegment(TransportMode.WALK))],
      false,
    );

    expect(query?.from).toEqual({ lat: START[1], lng: START[0] });
    expect(query?.to).toEqual({ lat: MIDDLE[1], lng: MIDDLE[0] });
  });

  it('porte la contrainte PMR, qui change le cheminement rendu (C12)', () => {
    const [query] = collectStreetPathQueries(
      [itineraryOf(straightSegment(TransportMode.WALK))],
      true,
    );

    expect(query?.wheelchair).toBe(true);
  });
});

describe('applyStreetGeometry', () => {
  const itinerary = itineraryOf(
    straightSegment(TransportMode.WALK),
    straightSegment(TransportMode.BIKE, MIDDLE, END),
  );

  /** Table des cheminements obtenus, indexée comme le service le fait. */
  function pathsFor(geometry: LineStringGeometry, wheelchair = false) {
    const [query] = collectStreetPathQueries([itinerary], wheelchair);
    return new Map([[streetPathKey(must(query, 'la demande de cheminement')), geometry]]);
  }

  /** Le segment de rang `index` du premier itinéraire enrichi. */
  function enrichedSegment(paths: ReadonlyMap<string, LineStringGeometry>, index: number) {
    const [enriched] = applyStreetGeometry([itinerary], paths, false);
    return must(must(enriched, "l'itinéraire enrichi").segments[index], `le segment ${index}`);
  }

  it('remplace la droite par le cheminement et marque le segment comme routé', () => {
    const walk = enrichedSegment(pathsFor(ROUTED), 0);

    expect(walk.geometrySource).toBe('routed');
    expect(walk.geometry?.coordinates.length).toBeGreaterThan(2);
  });

  it('raccorde le cheminement aux extrémités déclarées du segment', () => {
    // OTP raccroche le départ au tronçon de voirie le plus proche : sa
    // polyligne commence à quelques mètres du point demandé. Sans recollement,
    // le changement de mode ouvrirait un trou sur la carte.
    const walk = enrichedSegment(pathsFor(ROUTED), 0);
    const coordinates = must(walk.geometry, 'le tracé du segment enrichi').coordinates;

    expect(coordinates[0]).toEqual(START);
    expect(coordinates[coordinates.length - 1]).toEqual(MIDDLE);
  });

  it('laisse sa droite au segment dont le cheminement manque, et le dit (C10)', () => {
    const bike = enrichedSegment(pathsFor(ROUTED), 1);

    expect(bike.geometrySource).toBe('straight');
    expect(bike.geometry?.coordinates).toEqual([MIDDLE, END]);
  });

  it('écarte un cheminement hors de proportion avec le vol d’oiseau', () => {
    // Une extrémité raccrochée à un tronçon isolé du réseau : OTP fait le tour
    // de la ville pour la rejoindre. Le tracé aurait l'air calculé — la droite,
    // elle, ne prétend rien.
    const absurd: LineStringGeometry = {
      type: 'LineString',
      coordinates: [START, [4.95, 45.85], [4.75, 45.65], MIDDLE],
    };

    const walk = enrichedSegment(pathsFor(absurd), 0);

    expect(walk.geometrySource).toBe('straight');
    expect(walk.geometry?.coordinates).toEqual([START, MIDDLE]);
  });

  it("reconstruit le tracé d'ensemble à partir des segments enrichis", () => {
    const [enriched] = applyStreetGeometry([itinerary], pathsFor(ROUTED), false);
    const whole = must(
      must(enriched, "l'itinéraire enrichi").geometry,
      "le tracé d'ensemble",
    ).coordinates;

    // Le tracé global part du départ, passe par les sommets du cheminement
    // routé, et finit à l'arrivée : deux tracés contradictoires dans la même
    // réponse (des segments qui suivent les rues, un global qui coupe à
    // travers) seraient pires que pas de tracé du tout.
    expect(whole[0]).toEqual(START);
    expect(whole[whole.length - 1]).toEqual(END);
    expect(whole).toEqual(
      expect.arrayContaining([must(ROUTED.coordinates[1], 'un sommet du cheminement')]),
    );
  });

  it('ne modifie pas les itinéraires reçus', () => {
    applyStreetGeometry([itinerary], pathsFor(ROUTED), false);

    const original = must(itinerary.segments[0], 'le segment de marche');
    expect(original.geometry?.coordinates).toEqual([START, MIDDLE]);
    expect(original.geometrySource).toBe('straight');
  });

  it('rend la liste inchangée quand aucun cheminement n’a été obtenu', () => {
    const [enriched] = applyStreetGeometry([itinerary], new Map(), false);

    expect(enriched).toEqual(itinerary);
  });
});
