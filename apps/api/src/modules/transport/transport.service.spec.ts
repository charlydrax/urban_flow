import { Test } from '@nestjs/testing';

import { SharedMobilityService } from './shared-mobility.service';
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

/** Publication GBFS datant de `minutes` minutes. */
function publishedMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe('TransportService', () => {
  let service: TransportService;
  let probe: jest.Mock;
  let probeGbfs: jest.Mock;

  beforeEach(async () => {
    probe = jest.fn().mockResolvedValue({ reachable: true, serviceWindow: SERVICE_WINDOW });
    probeGbfs = jest.fn().mockResolvedValue({
      reachable: true,
      publishedAt: publishedMinutesAgo(1),
      stationCount: 428,
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        TransportService,
        { provide: TransitService, useValue: { probe } },
        { provide: SharedMobilityService, useValue: { probe: probeGbfs } },
      ],
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

  it('sonde réellement la source GBFS et rapporte sa fraîcheur (UF-303)', async () => {
    const [, gbfs] = await service.getStatus();

    expect(gbfs).toMatchObject({ source: 'gbfs', status: 'ok' });
    expect(gbfs.detail).toContain('428 station(s)');
    expect(probeGbfs).toHaveBeenCalledTimes(1);
  });

  it('déclare la source GBFS `down` quand le flux ne répond pas', async () => {
    probeGbfs.mockResolvedValue({
      reachable: false,
      publishedAt: null,
      stationCount: 0,
      reason: 'timeout',
    });

    const [, gbfs] = await service.getStatus();

    expect(gbfs.status).toBe('down');
    expect(gbfs.detail).toContain('timeout');
  });

  it('déclare la source GBFS `degraded` quand le flux n’est plus republié', async () => {
    probeGbfs.mockResolvedValue({
      reachable: true,
      publishedAt: publishedMinutesAgo(45),
      stationCount: 428,
    });

    const [, gbfs] = await service.getStatus();

    // Le flux répond, mais son contenu est figé : la nuance existe précisément
    // pour que le client puisse nuancer plutôt que masquer.
    expect(gbfs.status).toBe('degraded');
    expect(gbfs.detail).toContain('figé');
  });

  it('accepte un flux GBFS sans horodatage de publication', async () => {
    probeGbfs.mockResolvedValue({ reachable: true, publishedAt: null, stationCount: 12 });

    const [, gbfs] = await service.getStatus();

    expect(gbfs.status).toBe('ok');
    expect(gbfs.detail).toContain('sans horodatage');
  });

  it('sonde les deux sources en parallèle — un diagnostic ne cumule pas deux timeouts', async () => {
    let resolveOtp: (value: unknown) => void = () => {};
    probe.mockReturnValue(
      new Promise((resolve) => {
        resolveOtp = resolve;
      }),
    );

    const pending = service.getStatus();
    // GBFS est déjà parti alors que GTFS n'a pas répondu : la preuve que les
    // deux sondes ne s'attendent pas l'une l'autre.
    expect(probeGbfs).toHaveBeenCalledTimes(1);

    resolveOtp({ reachable: true, serviceWindow: SERVICE_WINDOW });
    await expect(pending).resolves.toHaveLength(2);
  });
});
