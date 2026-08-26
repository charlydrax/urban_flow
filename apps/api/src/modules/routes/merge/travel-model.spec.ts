import {
  BIKE_HANDLING_MINUTES,
  bikeDistanceMeters,
  bikeDurationMinutes,
  walkDistanceMeters,
  walkDurationMinutes,
} from './travel-model';

/**
 * Le modèle de déplacement n'a pas vocation à être exact — il n'y a pas de
 * routeur derrière. Ce qui est vérifié ici, ce sont ses **propriétés** : qu'il
 * majore toujours la distance à vol d'oiseau, qu'il récompense un corridor
 * aménagé, et qu'il ne prétende jamais qu'un déplacement prend zéro minute.
 */
describe('travel-model', () => {
  const PART_DIEU = { lat: 45.760515, lng: 4.859057 };
  const BELLECOUR = { lat: 45.757813, lng: 4.832011 };

  it('always walks further than the crow flies', () => {
    // Environ 2,1 km de vol d'oiseau entre les deux places.
    expect(walkDistanceMeters(PART_DIEU, BELLECOUR)).toBeGreaterThan(2100);
    expect(walkDistanceMeters(PART_DIEU, BELLECOUR)).toBeLessThan(3000);
  });

  it('detours less on a corridor served by cycle facilities', () => {
    const bare = bikeDistanceMeters(PART_DIEU, BELLECOUR, 0);
    const half = bikeDistanceMeters(PART_DIEU, BELLECOUR, 0.5);
    const equipped = bikeDistanceMeters(PART_DIEU, BELLECOUR, 1);

    expect(equipped).toBeLessThan(half);
    expect(half).toBeLessThan(bare);
  });

  it('treats an out-of-range coverage as no coverage rather than throwing', () => {
    // Une part hors [0,1] est un défaut d'appel ; le planificateur ne doit pas
    // tomber pour autant, et surtout pas promettre un raccourci imaginaire.
    const bare = bikeDistanceMeters(PART_DIEU, BELLECOUR, 0);
    expect(bikeDistanceMeters(PART_DIEU, BELLECOUR, -3)).toBe(bare);
    expect(bikeDistanceMeters(PART_DIEU, BELLECOUR, Number.NaN)).toBe(bare);
    expect(bikeDistanceMeters(PART_DIEU, BELLECOUR, 42)).toBe(
      bikeDistanceMeters(PART_DIEU, BELLECOUR, 1),
    );
  });

  it('never announces a zero-minute leg when there is a distance to cover', () => {
    expect(walkDurationMinutes(0)).toBe(0);
    expect(walkDurationMinutes(15)).toBe(1);
    expect(bikeDurationMinutes(50)).toBeGreaterThanOrEqual(BIKE_HANDLING_MINUTES);
  });

  it('charges the fixed cost of picking up and returning a shared bike', () => {
    // Sur une courte distance, ce coût fixe domine — c'est ce qui empêche le
    // planificateur de proposer un Vélo'v pour trois cents mètres.
    expect(bikeDurationMinutes(300)).toBeGreaterThan(walkDurationMinutes(300) / 2);
    // Sur une longue distance, il s'efface derrière le temps de pédalage.
    expect(bikeDurationMinutes(5000)).toBeLessThan(walkDurationMinutes(5000));
  });
});
