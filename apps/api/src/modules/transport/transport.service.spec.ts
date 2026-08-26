import { Test } from '@nestjs/testing';

import { TransitService } from './transit.service';
import { TransportService } from './transport.service';

/**
 * État des sources transport : c'est ce que le client interroge pour décider
 * d'afficher, ou non, un bandeau « mode dégradé » (C10).
 */

/** Période du miroir GTFS de développement : 14/04 → 13/07/2022, heure de Lyon. */
const SERVICE_WINDOW = {
  from: new Date(1649887200 * 1000).toISOString(),
  to: new Date(1657663200 * 1000).toISOString(),
};

describe('TransportService', () => {
  let service: TransportService;
  let probe: jest.Mock;

  beforeEach(async () => {
    probe = jest.fn().mockResolvedValue({ reachable: true, serviceWindow: SERVICE_WINDOW });

    const moduleRef = await Test.createTestingModule({
      providers: [TransportService, { provide: TransitService, useValue: { probe } }],
    }).compile();

    service = moduleRef.get(TransportService);
  });

  it('rapporte la source GTFS comme opérationnelle quand le moteur répond', async () => {
    const [gtfs] = await service.getStatus();

    expect(gtfs).toMatchObject({ source: 'gtfs', status: 'ok' });
    // La période est annoncée dans le fuseau du réseau : une période démarrant
    // à minuit heure de Lyon s'afficherait la veille si on la formatait en UTC.
    expect(gtfs.detail).toContain('2022-04-14');
    expect(gtfs.detail).toContain('2022-07-13');
  });

  it('rapporte la source GTFS comme `down` quand le moteur ne répond pas', async () => {
    probe.mockResolvedValue({ reachable: false, serviceWindow: null });

    const [gtfs] = await service.getStatus();

    expect(gtfs.status).toBe('down');
    expect(gtfs.detail).toContain('ne répond pas');
  });

  it('signale un graphe sans période de service déclarée', async () => {
    probe.mockResolvedValue({ reachable: true, serviceWindow: null });

    const [gtfs] = await service.getStatus();

    expect(gtfs.status).toBe('ok');
    expect(gtfs.detail).toContain('aucune période de service');
  });

  it('laisse GBFS en stub jusqu’à UF-303', async () => {
    const [, gbfs] = await service.getStatus();

    expect(gbfs).toMatchObject({ source: 'gbfs', status: 'mock' });
  });
});
