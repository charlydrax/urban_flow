import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { DEFAULT_PREFERENCES, UsersService } from '../users/users.service';
import { PlanRouteDto } from './dto/plan-route.dto';
import { RoutesService } from './routes.service';
import type { CollectedSources } from './sources/collected-sources';
import { SourceCollectorService } from './sources/source-collector.service';

/**
 * Tests du Service Itinéraire au point où UF-305 le laisse.
 *
 * La fusion multimodale relève du Sprint 4 ; ce qui est vérifié ici est
 * l'**orchestration** :
 *  - les préférences sont lues avant la collecte, et avec l'identité du JWT
 *    (anti-IDOR — C4) ;
 *  - la préférence PMR devient une entrée de la collecte (C12) ;
 *  - trois sources muettes donnent une réponse vide, pas une exception
 *    (recette 3 du ticket) ;
 *  - une extrémité sans coordonnées est un défaut d'appel, pas une panne.
 */
describe('RoutesService', () => {
  let service: RoutesService;
  let getPreferences: jest.Mock;
  let collectAllSources: jest.Mock;
  let toAvailability: jest.Mock;

  const userId = 'user-from-jwt';

  const dto = (overrides: Partial<PlanRouteDto> = {}): PlanRouteDto => ({
    from: { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 },
    to: { label: 'Bellecour', lat: 45.757813, lng: 4.832011 },
    // Le contrat du diagramme porte un userId ; il ne doit JAMAIS être utilisé.
    userId: 'user-from-body',
    ...overrides,
  });

  /** Collecte nominale : les trois sources ont répondu. */
  const collected = (overrides: Partial<CollectedSources> = {}): CollectedSources =>
    ({
      transit: { status: 'ok', data: null, elapsedMs: 12 },
      sharedMobility: { status: 'ok', data: null, elapsedMs: 8 },
      cyclePaths: { status: 'ok', data: null, elapsedMs: 3 },
      failures: [],
      allSourcesFailed: false,
      elapsedMs: 14,
      ...overrides,
    }) as CollectedSources;

  beforeEach(async () => {
    getPreferences = jest.fn().mockResolvedValue(DEFAULT_PREFERENCES);
    collectAllSources = jest.fn().mockResolvedValue(collected());
    toAvailability = jest.fn().mockReturnValue([
      { source: 'transit', available: true },
      { source: 'sharedMobility', available: true },
      { source: 'cyclePaths', available: true },
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoutesService,
        { provide: UsersService, useValue: { getPreferences } },
        { provide: SourceCollectorService, useValue: { collectAllSources, toAvailability } },
      ],
    }).compile();

    service = moduleRef.get(RoutesService);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  it('reads the preferences of the JWT account, never of the body (C4 / OWASP A01)', async () => {
    await service.plan(dto(), userId);

    expect(getPreferences).toHaveBeenCalledWith(userId);
    expect(getPreferences).not.toHaveBeenCalledWith('user-from-body');
  });

  it('reads the preferences before collecting, because they shape the request (C12)', async () => {
    const order: string[] = [];
    getPreferences.mockImplementation(() => {
      order.push('preferences');
      return Promise.resolve({ ...DEFAULT_PREFERENCES, reducedMobility: true });
    });
    collectAllSources.mockImplementation(() => {
      order.push('collect');
      return Promise.resolve(collected());
    });

    await service.plan(dto(), userId);

    // Paralléliser les deux reviendrait à interroger le moteur avant de savoir
    // quoi lui demander : la préférence PMR change la requête envoyée à OTP.
    expect(order).toEqual(['preferences', 'collect']);
    expect(collectAllSources).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 45.760515 }),
      expect.objectContaining({ lat: 45.757813 }),
      { reducedMobility: true },
    );
  });

  it('reports the real state of the sources alongside the itineraries', async () => {
    const result = await service.plan(dto(), userId);

    expect(result.sortedBy).toBe('carbonAsc');
    expect(result.sources).toHaveLength(3);
    expect(result.sources.every((source) => source.available)).toBe(true);
  });

  it('sorts the itineraries by increasing carbon footprint', async () => {
    const result = await service.plan(dto(), userId);

    const footprints = result.itineraries.map((itinerary) => itinerary.carbonGrams);
    expect(footprints).toEqual([...footprints].sort((a, b) => a - b));
  });

  it('answers with an empty list when every source failed, without throwing', async () => {
    collectAllSources.mockResolvedValue(collected({ allSourcesFailed: true }));
    toAvailability.mockReturnValue([
      { source: 'transit', available: false, reason: 'timeout' },
      { source: 'sharedMobility', available: false, reason: 'network' },
      { source: 'cyclePaths', available: false, reason: 'internal-error' },
    ]);

    // Recette 3 : un état clair, pas une exception non gérée. Un 500 ferait
    // croire à l'usager que SA requête est fautive.
    const result = await service.plan(dto(), userId);

    expect(result.itineraries).toEqual([]);
    expect(result.sources.every((source) => !source.available)).toBe(true);
  });

  it('rejects an endpoint without coordinates as a bad request, not as an outage', async () => {
    // Le géocodage est fait par le client (UF-203) : un label seul est un
    // défaut d'appel. Une liste vide serait ininterprétable.
    await expect(
      service.plan(dto({ from: { label: 'Part-Dieu' } }), userId),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.plan(dto({ to: { label: 'Bellecour', lat: 45.75 } }), userId),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Rien ne doit avoir été interrogé : ni la base, ni les trois sources.
    expect(getPreferences).not.toHaveBeenCalled();
    expect(collectAllSources).not.toHaveBeenCalled();
  });
});
