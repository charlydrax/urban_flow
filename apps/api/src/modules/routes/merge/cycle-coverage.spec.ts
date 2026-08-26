import { CycleFacilityType, type CycleSegment } from '@urbanflow/shared';

import { cycleCoverage } from './cycle-coverage';

/**
 * La couverture cyclable est une **mesure de proximité**, pas un calage sur le
 * réseau. Ces tests figent exactement cela : ce qu'elle sait dire, et ce
 * qu'elle ne prétend pas dire.
 */
describe('cycleCoverage', () => {
  const FROM = { lat: 45.7604, lng: 4.8598 };
  const TO = { lat: 45.7567, lng: 4.8483 };

  const segment = (coordinates: [number, number][]): CycleSegment => ({
    id: 'cp-test',
    name: 'Rue Garibaldi',
    facilityType: CycleFacilityType.CYCLE_TRACK,
    sourceFacilityType: 'Piste Cyclable',
    network: 'Voies Lyonnaises',
    surface: 'Enrobé',
    distanceMeters: 5,
    lengthMeters: 1000,
    geometry: { type: 'MultiLineString', coordinates: [coordinates] },
  });

  /** Échantillonne la droite entre deux points, pour simuler un tracé publié. */
  const along = (steps: number): [number, number][] => {
    const points: [number, number][] = [];
    for (let index = 0; index <= steps; index += 1) {
      const ratio = index / steps;
      points.push([FROM.lng + (TO.lng - FROM.lng) * ratio, FROM.lat + (TO.lat - FROM.lat) * ratio]);
    }
    return points;
  };

  it('reports no coverage when the cycle source gave nothing', () => {
    // Une absence de donnée n'est pas une absence d'aménagement — mais on ne
    // promet que ce qu'on a vu.
    expect(cycleCoverage(FROM, TO, [])).toBe(0);
  });

  it('reports full coverage for a facility following the corridor', () => {
    expect(cycleCoverage(FROM, TO, [segment(along(60))])).toBe(1);
  });

  it('reports no coverage for a facility in another neighbourhood', () => {
    // Une piste à Villeurbanne ne dessert pas un corridor du 3e arrondissement.
    const elsewhere = segment([
      [4.88, 45.77],
      [4.885, 45.772],
    ]);
    expect(cycleCoverage(FROM, TO, [elsewhere])).toBe(0);
  });

  it('reports partial coverage for a facility that only serves one half', () => {
    // Le tracé s'arrête à mi-corridor : la mesure doit le dire, pas arrondir.
    const half = along(60).slice(0, 31);
    const coverage = cycleCoverage(FROM, TO, [segment(half)]);

    expect(coverage).toBeGreaterThan(0.3);
    expect(coverage).toBeLessThan(0.7);
  });

  it('handles a degenerate corridor without dividing by zero', () => {
    expect(cycleCoverage(FROM, FROM, [segment(along(10))])).toBe(1);
  });
});
