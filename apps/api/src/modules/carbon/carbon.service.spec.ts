import { Test } from '@nestjs/testing';

import { TransportMode } from '../../common/enums/transport-mode.enum';
import { RouteSegmentDto } from '../routes/dto/itinerary.dto';
import { CarbonService } from './carbon.service';
import { CAR_REFERENCE_GRAMS_PER_KM, segmentCarbonGrams } from './emission-factors';

/**
 * Contrat de `computeFootprint` (UF-501) : l'empreinte d'un itinéraire est la
 * somme de ses segments, **recalculée** au barème du service, et publiée avec
 * le détail qui l'explique.
 *
 * Deux points s'y jouent :
 *
 * - depuis UF-401, le service ne fait plus confiance au `carbonGrams` que porte
 *   un segment — un segment fabriqué par la fusion et un segment venu d'ailleurs
 *   sont valorisés pareil ;
 * - depuis UF-501, il rend le **détail** : un total seul ne dit pas d'où vient
 *   le CO₂, et c'est précisément ce que « calcul segment par segment » promet.
 */
describe('CarbonService', () => {
  let service: CarbonService;

  /** Segment d'essai — seuls le mode et la distance entrent dans le calcul. */
  const segment = (
    mode: TransportMode,
    distanceMeters: number,
    carbonGrams = 0,
  ): RouteSegmentDto => ({
    mode,
    from: 'A',
    to: 'B',
    durationMinutes: 10,
    distanceMeters,
    carbonGrams,
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CarbonService],
    }).compile();

    service = moduleRef.get(CarbonService);
  });

  it('sums the carbon footprint of all segments', () => {
    const footprint = service.computeFootprint([
      segment(TransportMode.WALK, 400),
      segment(TransportMode.METRO, 3200),
    ]);

    // 3,2 km de métro au barème du service ; la marche ne coûte rien.
    expect(footprint.totalGrams).toBe(segmentCarbonGrams(TransportMode.METRO, 3200));
    expect(footprint.totalGrams).toBeGreaterThan(0);
  });

  it('details the footprint segment by segment, in the order of the trip', () => {
    const footprint = service.computeFootprint([
      segment(TransportMode.WALK, 400),
      segment(TransportMode.BUS, 4000),
      segment(TransportMode.WALK, 300),
    ]);

    // Une ligne par segment, dans l'ordre : la correspondance avec
    // `Itinerary.segments` est positionnelle, l'affichage en dépend.
    expect(footprint.segments).toHaveLength(3);
    expect(footprint.segments.map((line) => line.mode)).toEqual([
      TransportMode.WALK,
      TransportMode.BUS,
      TransportMode.WALK,
    ]);

    // Chaque ligne porte le facteur qui l'a produite : c'est ce qui rend le
    // gramme refaisable de tête plutôt que croyable sur parole.
    const [, bus] = footprint.segments;
    expect(bus?.factorGramsPerKm).toBe(95);
    expect(bus?.grams).toBe(segmentCarbonGrams(TransportMode.BUS, 4000));
  });

  it('keeps the total equal to the sum of the published lines', () => {
    // Arrondir segment par segment puis sommer ne donne pas le même nombre que
    // sommer puis arrondir. Le total affiché doit être celui des lignes
    // affichées, sinon l'écran se contredit lui-même.
    const footprint = service.computeFootprint([
      segment(TransportMode.BUS, 1234),
      segment(TransportMode.TRAM, 2345),
      segment(TransportMode.SCOOTER, 987),
    ]);

    const sum = footprint.segments.reduce((total, line) => total + line.grams, 0);
    expect(footprint.totalGrams).toBe(sum);
  });

  it('ignores the value carried by a segment and applies its own scale', () => {
    // Un appelant qui annoncerait une empreinte nulle sur un trajet en bus ne
    // doit pas pouvoir la faire publier telle quelle.
    const footprint = service.computeFootprint([segment(TransportMode.BUS, 4000, 0)]);

    expect(footprint.totalGrams).toBe(segmentCarbonGrams(TransportMode.BUS, 4000));
  });

  it('puts a soft itinerary at roughly zero and a motorised one well above', () => {
    // Recette du ticket : marche/vélo ≈ 0, motorisé nettement supérieur.
    const soft = service.computeFootprint([
      segment(TransportMode.WALK, 900),
      segment(TransportMode.BIKE, 3000),
    ]);
    const motorised = service.computeFootprint([
      segment(TransportMode.WALK, 400),
      segment(TransportMode.BUS, 5200),
    ]);

    expect(soft.totalGrams).toBeLessThanOrEqual(10);
    expect(motorised.totalGrams).toBeGreaterThan(soft.totalGrams * 10);
  });

  it('gives two different itineraries two different, plausible footprints', () => {
    // Même trajet de 5 km, deux façons de le faire : le classement doit se lire
    // dans les chiffres, sinon l'app n'oriente vers rien.
    const byBike = service.computeFootprint([segment(TransportMode.BIKE, 5000)]);
    const byBus = service.computeFootprint([segment(TransportMode.BUS, 5000)]);

    expect(byBike.totalGrams).not.toBe(byBus.totalGrams);
    expect(byBike.totalGrams).toBeLessThan(byBus.totalGrams);
    // Plausible : un bus reste sous la voiture solo, un vélo très en dessous.
    expect(byBus.totalGrams).toBeLessThan(byBus.carEquivalentGrams);
    expect(byBike.totalGrams).toBeLessThan(byBus.totalGrams / 10);
  });

  it('compares the trip to the same distance driven alone', () => {
    const footprint = service.computeFootprint([
      segment(TransportMode.WALK, 1000),
      segment(TransportMode.METRO, 4000),
    ]);

    // La référence porte sur la distance réellement parcourue, marche comprise.
    expect(footprint.carEquivalentGrams).toBe(CAR_REFERENCE_GRAMS_PER_KM * 5);
    expect(footprint.avoidedGrams).toBe(footprint.carEquivalentGrams - footprint.totalGrams);
    expect(footprint.avoidedGrams).toBeGreaterThan(0);
  });

  it('never announces a negative saving', () => {
    // Aucun mode du barème ne fait pire que la voiture solo, mais le jour où le
    // barème s'affinera, « −40 g économisés » n'aurait aucun sens à l'écran.
    const footprint = service.computeFootprint([]);

    expect(footprint.avoidedGrams).toBe(0);
  });

  it('returns an empty, zeroed footprint for an empty itinerary', () => {
    const footprint = service.computeFootprint([]);

    expect(footprint.totalGrams).toBe(0);
    expect(footprint.segments).toEqual([]);
    expect(footprint.carEquivalentGrams).toBe(0);
  });
});
