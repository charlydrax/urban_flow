import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { SearchHistoryService } from '../../search-history/search-history.service';
import { DEFAULT_PREFERENCES, UsersService } from '../../users/users.service';
import { TestSourcesDto } from '../dto/test-sources.dto';
import type { CollectedSources } from './collected-sources';
import { SourceCollectorService } from './source-collector.service';
import { SourceDiagnosticsService } from './source-diagnostics.service';

/**
 * Tests de l'endpoint interne de test des sources (UF-306).
 *
 * Ce qui est vérifié ici est la **recette du ticket**, pas la collecte
 * elle-même — celle-ci a sa propre suite (`source-collector.service.spec.ts`) :
 *  - les données des trois sources sont identifiables **séparément** (recette 3) ;
 *  - le trajet sondé peut venir de l'historique (UF-204), et seulement de celui
 *    du compte du JWT (C4 / OWASP A01) ;
 *  - un diagnostic n'écrit **jamais** dans l'historique (C8) ;
 *  - trois sources muettes restent une réponse, pas une exception ;
 *  - l'endpoint se ferme hors développement.
 *
 * Aucun réseau, aucune base : le collecteur est simulé. Ce qu'on mesure est
 * l'orchestration du diagnostic, pas la disponibilité réelle de Vélo'v.
 */
describe('SourceDiagnosticsService', () => {
  let getPreferences: jest.Mock;
  let collectAllSources: jest.Mock;
  let findOwnedById: jest.Mock;
  let searchHistory: { findOwnedById: jest.Mock; create: jest.Mock; findRecent: jest.Mock };

  const userId = 'user-from-jwt';

  const dto = (overrides: Partial<TestSourcesDto> = {}): TestSourcesDto => ({
    from: { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 },
    to: { label: 'Bellecour', lat: 45.757813, lng: 4.832011 },
    ...overrides,
  });

  /** Collecte nominale : les trois sources ont répondu, avec des durées distinctes. */
  const collected = (overrides: Partial<CollectedSources> = {}): CollectedSources =>
    ({
      transit: { status: 'ok', data: { status: 'ok', journeys: [] }, elapsedMs: 1840 },
      sharedMobility: { status: 'ok', data: { origin: {}, destination: {} }, elapsedMs: 210 },
      cyclePaths: { status: 'ok', data: { origin: {}, destination: {} }, elapsedMs: 47 },
      failures: [],
      allSourcesFailed: false,
      elapsedMs: 1875,
      ...overrides,
    }) as CollectedSources;

  /** Instancie le service avec le drapeau de configuration voulu. */
  async function build(flag: string | undefined = 'true'): Promise<SourceDiagnosticsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SourceDiagnosticsService,
        { provide: UsersService, useValue: { getPreferences } },
        { provide: SourceCollectorService, useValue: { collectAllSources } },
        { provide: SearchHistoryService, useValue: searchHistory },
        { provide: ConfigService, useValue: { get: () => flag } },
      ],
    }).compile();

    const service = moduleRef.get(SourceDiagnosticsService);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    return service;
  }

  beforeEach(() => {
    getPreferences = jest.fn().mockResolvedValue(DEFAULT_PREFERENCES);
    collectAllSources = jest.fn().mockResolvedValue(collected());
    findOwnedById = jest.fn().mockResolvedValue(null);
    searchHistory = { findOwnedById, create: jest.fn(), findRecent: jest.fn() };
  });

  it('reports each of the three sources separately, with its own timing', async () => {
    const service = await build();

    const result = await service.testSources(dto(), userId);

    // Recette 3 : un objet par source, nommé, et jamais fondu dans un agrégat.
    expect(result.sources.transit).toMatchObject({ source: 'transit', status: 'ok' });
    expect(result.sources.sharedMobility).toMatchObject({ source: 'sharedMobility', status: 'ok' });
    expect(result.sources.cyclePaths).toMatchObject({ source: 'cyclePaths', status: 'ok' });
    expect(result.sources.transit.data).toEqual({ status: 'ok', journeys: [] });
  });

  it('publishes per-source timings that show the calls ran in parallel (C10)', async () => {
    const service = await build();

    const result = await service.testSources(dto(), userId);

    // La collecte dure à peu près la source la plus lente, pas la somme des
    // trois : c'est la preuve observable du parallélisme demandée par le ticket.
    const slowest = Math.max(
      result.sources.transit.elapsedMs,
      result.sources.sharedMobility.elapsedMs,
      result.sources.cyclePaths.elapsedMs,
    );
    expect(result.elapsedMs).toBeLessThan(
      result.sources.transit.elapsedMs +
        result.sources.sharedMobility.elapsedMs +
        result.sources.cyclePaths.elapsedMs,
    );
    expect(result.elapsedMs).toBeGreaterThanOrEqual(slowest);
  });

  it('reads the preferences of the JWT account and applies them to the collection (C4, C12)', async () => {
    getPreferences.mockResolvedValue({ ...DEFAULT_PREFERENCES, reducedMobility: true });
    const service = await build();

    const result = await service.testSources(dto(), userId);

    expect(getPreferences).toHaveBeenCalledWith(userId);
    expect(collectAllSources).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      reducedMobility: true,
    });
    // Publiée dans la réponse : sans elle, une absence de trajet TC s'expliquerait
    // aussi bien par une panne que par la contrainte fauteuil roulant.
    expect(result.preferences).toEqual({ reducedMobility: true });
  });

  it('names the technical cause of a failed source, and nulls its payload', async () => {
    collectAllSources.mockResolvedValue(
      collected({
        sharedMobility: {
          status: 'failed',
          data: null,
          elapsedMs: 5003,
          failure: { source: 'sharedMobility', kind: 'unavailable', reason: 'timeout' },
        },
        failures: [{ source: 'sharedMobility', kind: 'unavailable', reason: 'timeout' }],
      }),
    );
    const service = await build();

    const result = await service.testSources(dto(), userId);

    expect(result.sources.sharedMobility).toEqual({
      source: 'sharedMobility',
      status: 'failed',
      elapsedMs: 5003,
      // La cause interne est publiée ici, et nulle part ailleurs : c'est ce qui
      // rend l'endpoint utile, et ce qui impose de le fermer en production (C11).
      failure: { kind: 'unavailable', reason: 'timeout' },
      data: null,
    });
    // Le nom de la source n'est pas répété dans la panne : l'enveloppe le porte.
    expect(result.sources.sharedMobility.failure).not.toHaveProperty('source');
  });

  it('answers with a full report when all three sources failed, never an exception', async () => {
    collectAllSources.mockResolvedValue(
      collected({
        transit: { status: 'failed', data: null, elapsedMs: 12000 },
        sharedMobility: { status: 'failed', data: null, elapsedMs: 5000 },
        cyclePaths: { status: 'failed', data: null, elapsedMs: 3 },
        failures: [
          { source: 'transit', kind: 'unavailable', reason: 'timeout' },
          { source: 'sharedMobility', kind: 'unavailable', reason: 'network' },
          { source: 'cyclePaths', kind: 'error', reason: 'connection refused' },
        ],
        allSourcesFailed: true,
      }),
    );
    const service = await build();

    const result = await service.testSources(dto(), userId);

    expect(result.allSourcesFailed).toBe(true);
    expect(result.sources.transit.status).toBe('failed');
  });

  it('replays a stored search from the history of the JWT account (UF-204, C4)', async () => {
    findOwnedById.mockResolvedValue({
      id: 'search-1',
      from: { label: 'Gare de Vaise', lat: 45.78, lng: 4.804 },
      to: { label: 'Confluence', lat: 45.741, lng: 4.816 },
      selectedSummary: null,
      carbonGrams: null,
      createdAt: '2026-08-26T09:00:00.000Z',
    });
    const service = await build();

    const result = await service.testSources(
      dto({ from: undefined, to: undefined, searchHistoryId: 'search-1' }),
      userId,
    );

    // Le compte du JWT est la clé de lecture : rejouer l'entrée d'autrui est
    // structurellement impossible, pas seulement interdit.
    expect(findOwnedById).toHaveBeenCalledWith(userId, 'search-1');
    expect(collectAllSources).toHaveBeenCalledWith(
      { label: 'Gare de Vaise', lat: 45.78, lng: 4.804 },
      { label: 'Confluence', lat: 45.741, lng: 4.816 },
      expect.anything(),
    );
    expect(result.query.replayedSearchHistoryId).toBe('search-1');
  });

  it('rejects a search that is not in this account history (C4 / OWASP A01)', async () => {
    findOwnedById.mockResolvedValue(null);
    const service = await build();

    // 404 et non 403 : distinguer « pas à vous » de « n'existe pas » confirmerait
    // l'existence de l'entrée visée.
    await expect(
      service.testSources(
        dto({ from: undefined, to: undefined, searchHistoryId: 'someone-else' }),
        userId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(collectAllSources).not.toHaveBeenCalled();
  });

  it('never records the probe in the search history (C8)', async () => {
    const service = await build();

    await service.testSources(dto(), userId);

    // Sonder l'infrastructure n'est pas un déplacement : l'inscrire fausserait
    // les trajets récents de l'usager et son futur bilan carbone.
    expect(searchHistory.create).not.toHaveBeenCalled();
  });

  it('marks a direct search as not replayed', async () => {
    const service = await build();

    const result = await service.testSources(dto(), userId);

    expect(result.query.replayedSearchHistoryId).toBeNull();
    expect(findOwnedById).not.toHaveBeenCalled();
  });

  it('refuses a body with neither endpoints nor a search to replay', async () => {
    const service = await build();

    await expect(
      service.testSources(dto({ from: undefined, to: undefined }), userId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(collectAllSources).not.toHaveBeenCalled();
  });

  it('behaves like an unknown route when the endpoint is disabled', async () => {
    const service = await build('false');

    await expect(service.testSources(dto(), userId)).rejects.toBeInstanceOf(NotFoundException);
    // Rien n'est interrogé : un endpoint fermé ne doit pas coûter une collecte.
    expect(getPreferences).not.toHaveBeenCalled();
    expect(collectAllSources).not.toHaveBeenCalled();
  });

  it('stays open in development when no flag is configured', async () => {
    const service = await build(undefined);

    await expect(service.testSources(dto(), userId)).resolves.toBeDefined();
  });
});
