import { Test } from '@nestjs/testing';

import { TransportMode } from '../../common/enums/transport-mode.enum';
import { CarbonService } from './carbon.service';
import { segmentCarbonGrams } from './emission-factors';

/**
 * Contrat de `computeFootprint` : l'empreinte d'un itinéraire est la somme de
 * ses segments, **recalculée** au barème du service.
 *
 * Le point important est là : depuis UF-401 le service ne fait plus confiance
 * au `carbonGrams` que porte un segment. Un segment fabriqué par la fusion et
 * un segment venu d'ailleurs sont valorisés pareil, et une valeur fantaisiste
 * ne peut pas se glisser dans le total publié.
 */
describe('CarbonService', () => {
  let service: CarbonService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CarbonService],
    }).compile();

    service = moduleRef.get(CarbonService);
  });

  it('sums the carbon footprint of all segments', () => {
    const total = service.computeFootprint([
      {
        mode: TransportMode.WALK,
        from: 'A',
        to: 'B',
        durationMinutes: 5,
        distanceMeters: 400,
        carbonGrams: 0,
      },
      {
        mode: TransportMode.METRO,
        from: 'B',
        to: 'C',
        durationMinutes: 8,
        distanceMeters: 3200,
        carbonGrams: 0,
      },
    ]);

    // 3,2 km de métro au barème du service ; la marche ne coûte rien.
    expect(total).toBe(segmentCarbonGrams(TransportMode.METRO, 3200));
    expect(total).toBeGreaterThan(0);
  });

  it('ignores the value carried by a segment and applies its own scale', () => {
    // Un appelant qui annoncerait une empreinte nulle sur un trajet en bus ne
    // doit pas pouvoir la faire publier telle quelle.
    const total = service.computeFootprint([
      {
        mode: TransportMode.BUS,
        from: 'A',
        to: 'B',
        durationMinutes: 20,
        distanceMeters: 4000,
        carbonGrams: 0,
      },
    ]);

    expect(total).toBe(segmentCarbonGrams(TransportMode.BUS, 4000));
  });

  it('returns 0 for an empty itinerary', () => {
    expect(service.computeFootprint([])).toBe(0);
  });
});
