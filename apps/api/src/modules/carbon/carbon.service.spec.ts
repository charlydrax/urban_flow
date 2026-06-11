import { Test } from '@nestjs/testing';

import { TransportMode } from '../../common/enums/transport-mode.enum';
import { CarbonService } from './carbon.service';

/**
 * Test smoke du Service Carbone : vérifie que la chaîne de test Jest fonctionne
 * et fige le contrat de `computeFootprint` (somme des segments).
 * Les cas réels (facteurs d'émission par mode) seront ajoutés avec l'implémentation.
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
        carbonGrams: 12,
      },
    ]);

    expect(total).toBe(12);
  });

  it('returns 0 for an empty itinerary', () => {
    expect(service.computeFootprint([])).toBe(0);
  });
});
