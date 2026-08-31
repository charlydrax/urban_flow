import { TransportMode, type Itinerary, type RouteSegment } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import type { UserPosition } from './geolocation';
import {
  ARRIVAL_RADIUS_METERS,
  OFF_ROUTE_METERS,
  computeRouteProgress,
  distanceMeters,
  projectOnPath,
} from './route-progress';

/**
 * Repère de travail : un couloir est-ouest à la latitude de Lyon, pour que les
 * distances attendues se calculent de tête. À 45,76° N, un degré de longitude
 * vaut ≈ 77,6 km ; on travaille donc en millièmes de degré ≈ 77,6 m.
 */
const LAT = 45.76;

/** Position mesurée — la précision annoncée n'entre pas dans la projection. */
function at(lng: number, lat = LAT, accuracyMeters = 12): UserPosition {
  return { lat, lng, accuracyMeters };
}

function segment(
  mode: TransportMode,
  durationMinutes: number,
  coordinates: [number, number][] | null,
  extra: Partial<RouteSegment> = {},
): RouteSegment {
  return {
    mode,
    from: 'A',
    to: 'B',
    durationMinutes,
    distanceMeters: 1000,
    carbonGrams: 0,
    ...(coordinates ? { geometry: { type: 'LineString', coordinates } } : {}),
    ...extra,
  };
}

function itinerary(segments: RouteSegment[]): Itinerary {
  return {
    id: 'itin-1',
    summary: 'Vélo + Bus C3',
    durationMinutes: segments.reduce((total, s) => total + s.durationMinutes, 0),
    distanceMeters: segments.reduce((total, s) => total + s.distanceMeters, 0),
    carbonGrams: 240,
    accessible: false,
    segments,
  };
}

describe('distanceMeters', () => {
  it('rend zéro pour deux points confondus', () => {
    expect(distanceMeters({ lat: LAT, lng: 4.85 }, { lat: LAT, lng: 4.85 })).toBe(0);
  });

  it('mesure un millième de degré de longitude à environ 77 m sous nos latitudes', () => {
    const meters = distanceMeters({ lat: LAT, lng: 4.85 }, { lat: LAT, lng: 4.851 });
    expect(meters).toBeGreaterThan(70);
    expect(meters).toBeLessThan(85);
  });

  it('est symétrique', () => {
    const a = { lat: 45.75, lng: 4.85 };
    const b = { lat: 45.77, lng: 4.87 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });
});

describe('projectOnPath', () => {
  const path: [number, number][] = [
    [4.85, LAT],
    [4.852, LAT],
  ];

  it('refuse une polyligne de moins de deux sommets', () => {
    expect(projectOnPath(at(4.85), [])).toBeNull();
    expect(projectOnPath(at(4.85), [[4.85, LAT]])).toBeNull();
  });

  it('projette un point situé au milieu du tronçon à mi-longueur', () => {
    const projection = projectOnPath(at(4.851), path);

    expect(projection).not.toBeNull();
    expect(projection!.offRouteMeters).toBeLessThan(1);
    expect(projection!.alongMeters).toBeCloseTo(projection!.lengthMeters / 2, 1);
  });

  it('mesure l’écart perpendiculaire d’un point situé à côté du tracé', () => {
    // Un millième de degré de LATITUDE ≈ 111 m, quelle que soit la longitude.
    const projection = projectOnPath(at(4.851, LAT + 0.001), path);

    expect(projection!.offRouteMeters).toBeGreaterThan(100);
    expect(projection!.offRouteMeters).toBeLessThan(120);
  });

  it('borne la projection aux extrémités plutôt que de prolonger la droite', () => {
    // Point situé bien AVANT le début du tracé : le pied de la perpendiculaire
    // sort du tronçon, c'est le premier sommet qui doit faire foi.
    const projection = projectOnPath(at(4.84), path);

    expect(projection!.alongMeters).toBe(0);
    expect(projection!.point.lng).toBeCloseTo(4.85, 6);
  });

  it('compte la longueur totale sur une polyligne à plusieurs tronçons', () => {
    const projection = projectOnPath(at(4.8515), [
      [4.85, LAT],
      [4.851, LAT],
      [4.852, LAT],
    ]);

    expect(projection!.lengthMeters).toBeCloseTo(
      distanceMeters({ lat: LAT, lng: 4.85 }, { lat: LAT, lng: 4.852 }),
      1,
    );
  });
});

describe('computeRouteProgress', () => {
  /** Deux segments bout à bout : vélo de 4,850 à 4,852, puis bus de 4,852 à 4,856. */
  const trip = itinerary([
    segment(TransportMode.BIKE, 10, [
      [4.85, LAT],
      [4.852, LAT],
    ]),
    segment(TransportMode.BUS, 6, [
      [4.852, LAT],
      [4.856, LAT],
    ]),
  ]);

  it('rend null quand aucun segment ne porte de tracé exploitable', () => {
    const untraced = itinerary([
      segment(TransportMode.WALK, 3, null),
      segment(TransportMode.BUS, 6, [[4.85, LAT]]),
    ]);

    expect(computeRouteProgress(untraced, at(4.85))).toBeNull();
  });

  it('retient le segment dont le tracé passe le plus près', () => {
    expect(computeRouteProgress(trip, at(4.851))!.segmentIndex).toBe(0);
    expect(computeRouteProgress(trip, at(4.854))!.segmentIndex).toBe(1);
  });

  it('avance de segment en segment à mesure que la position progresse', () => {
    const indexes = [4.8505, 4.8515, 4.853, 4.855].map(
      (lng) => computeRouteProgress(trip, at(lng))!.segmentIndex,
    );

    expect(indexes).toEqual([0, 0, 1, 1]);
  });

  it('estime la durée restante d’un segment au prorata de la distance restante', () => {
    const progress = computeRouteProgress(trip, at(4.851))!;

    // À mi-parcours d'un segment vélo annoncé à 10 min : 5 min restantes, plus
    // les 6 min entières du bus qui suit.
    expect(progress.segmentRemainingMinutes).toBeCloseTo(5, 1);
    expect(progress.totalRemainingMinutes).toBeCloseTo(11, 1);
  });

  it('compte les segments suivants pour leur durée entière', () => {
    // Tout début du trajet : rien n'est encore consommé.
    const progress = computeRouteProgress(trip, at(4.85))!;

    expect(progress.segmentRemainingMinutes).toBeCloseTo(10, 1);
    expect(progress.totalRemainingMinutes).toBeCloseTo(16, 1);
  });

  it('recule quand l’usager fait demi-tour, au lieu de rester bloqué', () => {
    const forward = computeRouteProgress(trip, at(4.8535))!;
    const back = computeRouteProgress(trip, at(4.851))!;

    expect(forward.segmentIndex).toBe(1);
    expect(back.segmentIndex).toBe(0);
    expect(back.totalRemainingMeters).toBeGreaterThan(forward.totalRemainingMeters);
  });

  it('signale l’écart au tracé au-delà du seuil, sans jamais bloquer', () => {
    const onRoute = computeRouteProgress(trip, at(4.851))!;
    // ~222 m au nord du tracé : bien au-delà du seuil.
    const far = computeRouteProgress(trip, at(4.851, LAT + 0.002))!;

    expect(onRoute.offRoute).toBe(false);
    expect(far.offRouteMeters).toBeGreaterThan(OFF_ROUTE_METERS);
    expect(far.offRoute).toBe(true);
    // L'écart n'empêche pas de continuer à guider.
    expect(far.segmentIndex).toBe(0);
  });

  it('déclare l’arrivée au voisinage du dernier point du dernier segment tracé', () => {
    const arrived = computeRouteProgress(trip, at(4.856))!;

    expect(arrived.arrived).toBe(true);
    expect(arrived.completedRatio).toBeCloseTo(1, 1);
  });

  it('ne déclare pas l’arrivée à la fin d’un segment intermédiaire', () => {
    // 4,852 est la fin du segment vélo — mais pas la destination.
    expect(computeRouteProgress(trip, at(4.852))!.arrived).toBe(false);
  });

  it('n’exige pas d’être exactement au but : le rayon couvre l’imprécision du GPS', () => {
    // Un demi-millième de degré de latitude ≈ 55 m : au-delà du rayon.
    const near = computeRouteProgress(trip, at(4.856, LAT + 0.0002))!;
    const tooFar = computeRouteProgress(trip, at(4.856, LAT + 0.0005))!;

    expect(
      distanceMeters({ lat: LAT, lng: 4.856 }, { lat: LAT + 0.0002, lng: 4.856 }),
    ).toBeLessThan(ARRIVAL_RADIUS_METERS);
    expect(near.arrived).toBe(true);
    expect(tooFar.arrived).toBe(false);
  });

  it('borne la part parcourue entre 0 et 1', () => {
    for (const lng of [4.84, 4.85, 4.853, 4.856, 4.87]) {
      const progress = computeRouteProgress(trip, at(lng))!;
      expect(progress.completedRatio).toBeGreaterThanOrEqual(0);
      expect(progress.completedRatio).toBeLessThanOrEqual(1);
    }
  });

  it('ignore les segments sans tracé sans décaler l’index publié', () => {
    // Une correspondance sur place, sans géométrie, entre les deux segments
    // tracés : l'index rendu doit rester celui d'`Itinerary.segments`.
    const withGap = itinerary([
      segment(TransportMode.BIKE, 10, [
        [4.85, LAT],
        [4.852, LAT],
      ]),
      segment(TransportMode.WALK, 2, null),
      segment(TransportMode.BUS, 6, [
        [4.852, LAT],
        [4.856, LAT],
      ]),
    ]);

    expect(computeRouteProgress(withGap, at(4.854))!.segmentIndex).toBe(2);
  });
});
