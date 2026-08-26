import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RoutePriority, TransportMode } from '@urbanflow/shared';

import { CarbonService } from '../carbon/carbon.service';
import { SearchHistoryService } from '../search-history/search-history.service';
import { DEFAULT_PREFERENCES, UsersService } from '../users/users.service';
import { PlanRouteDto } from './dto/plan-route.dto';
import { RoutesService } from './routes.service';
import type { CollectedSources } from './sources/collected-sources';
import { SourceCollectorService } from './sources/source-collector.service';

/**
 * Tests du Service Itinéraire en tant qu'**orchestrateur**.
 *
 * L'algorithme de fusion a ses propres tests
 * (`merge/itinerary-merger.spec.ts`), sur des données figées et sans conteneur
 * d'injection. Ce qui est vérifié ici, c'est l'enchaînement du flux de
 * référence :
 *  - les préférences sont lues avant la collecte, et avec l'identité du JWT
 *    (anti-IDOR — C4) ;
 *  - la préférence PMR devient une entrée de la collecte (C12) ;
 *  - la fusion reçoit bien la collecte, et son résultat est valorisé par le
 *    Service Carbone (étape 6) ;
 *  - trois sources muettes donnent une réponse vide, pas une exception (C10) ;
 *  - une extrémité sans coordonnées est un défaut d'appel, pas une panne ;
 *  - la recherche est enregistrée dans l'historique à chaque appel, sur le
 *    compte du JWT, et une écriture ratée ne coûte pas les itinéraires (UF-402).
 */
describe('RoutesService', () => {
  let service: RoutesService;
  let getPreferences: jest.Mock;
  let collectAllSources: jest.Mock;
  let toAvailability: jest.Mock;
  let computeFootprint: jest.Mock;
  let createSearchHistory: jest.Mock;

  const userId = 'user-from-jwt';

  // Depuis UF-402 le corps ne porte plus que les deux extrémités : il n'y a
  // plus de `userId` à opposer à celui du JWT (C4).
  const dto = (overrides: Partial<PlanRouteDto> = {}): PlanRouteDto => ({
    from: { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 },
    to: { label: 'Bellecour', lat: 45.757813, lng: 4.832011 },
    ...overrides,
  });

  /**
   * Collecte nominale : un trajet TC exploitable, aucune borne, aucun tronçon.
   *
   * Volontairement minimale — l'objet de ces tests est l'orchestration, pas la
   * richesse des propositions. Un seul trajet suffit à prouver que la fusion a
   * bien été appelée avec ce que la collecte a rapporté.
   */
  const collected = (overrides: Partial<CollectedSources> = {}): CollectedSources =>
    ({
      transit: {
        status: 'ok',
        elapsedMs: 12,
        data: {
          status: 'ok',
          requestedDate: '2026-08-26',
          serviceDate: '2022-09-01',
          dateAdjusted: true,
          journeys: [
            {
              id: 'transit-1',
              departureAt: '2026-08-26T08:00:00+02:00',
              arrivalAt: '2026-08-26T08:12:00+02:00',
              durationMinutes: 12,
              walkDistanceMeters: 300,
              transfers: 0,
              accessible: true,
              legs: [
                {
                  mode: TransportMode.METRO,
                  sourceMode: 'SUBWAY',
                  transit: true,
                  from: { name: 'Part-Dieu', lat: 45.760515, lng: 4.859057 },
                  to: { name: 'Bellecour', lat: 45.757813, lng: 4.832011 },
                  departureAt: '2026-08-26T08:00:00+02:00',
                  arrivalAt: '2026-08-26T08:12:00+02:00',
                  durationMinutes: 12,
                  distanceMeters: 2200,
                  line: 'B',
                  accessible: true,
                },
              ],
            },
          ],
        },
      },
      sharedMobility: { status: 'ok', elapsedMs: 8, data: null },
      cyclePaths: { status: 'ok', elapsedMs: 3, data: null },
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
    computeFootprint = jest.fn().mockReturnValue(42);
    createSearchHistory = jest.fn().mockResolvedValue({ id: 'history-1' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoutesService,
        { provide: UsersService, useValue: { getPreferences } },
        { provide: SourceCollectorService, useValue: { collectAllSources, toAvailability } },
        { provide: CarbonService, useValue: { computeFootprint } },
        { provide: SearchHistoryService, useValue: { create: createSearchHistory } },
      ],
    }).compile();

    service = moduleRef.get(RoutesService);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  });

  it('works entirely off the JWT identity — the body carries none (C4 / OWASP A01)', async () => {
    await service.plan(dto(), userId);

    expect(getPreferences).toHaveBeenCalledWith(userId);
    // La même identité sert aux deux accès au compte : lecture du profil et
    // écriture de l'historique. Aucun autre identifiant n'entre dans le service.
    expect(createSearchHistory).toHaveBeenCalledWith(userId, expect.anything());
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

    expect(result.sources).toHaveLength(3);
    expect(result.sources.every((source) => source.available)).toBe(true);
  });

  it('builds real itineraries out of what the sources returned, no mock left', async () => {
    const result = await service.plan(dto(), userId);

    expect(result.itineraries.length).toBeGreaterThan(0);
    const [itinerary] = result.itineraries;
    expect(itinerary?.segments[0]?.from).toBe('Part-Dieu');
    expect(itinerary?.segments[itinerary.segments.length - 1]?.to).toBe('Bellecour');
    expect(itinerary?.summary).toContain('Métro B');
  });

  it('publishes the footprint computed by the Carbon service (step 6 of the flow)', async () => {
    const result = await service.plan(dto(), userId);

    expect(computeFootprint).toHaveBeenCalledTimes(result.itineraries.length);
    expect(computeFootprint).toHaveBeenCalledWith(result.itineraries[0]?.segments);
    // Le barème appartient au Service Carbone : la fusion ne fait qu'estimer
    // pour classer ses candidats, c'est cette valeur-ci qui est publiée.
    expect(result.itineraries.every((itinerary) => itinerary.carbonGrams === 42)).toBe(true);
  });

  it('publishes the sort key derived from the profile priority', async () => {
    const green = await service.plan(dto(), userId);
    expect(green.sortedBy).toBe('carbonAsc');

    getPreferences.mockResolvedValue({
      ...DEFAULT_PREFERENCES,
      priority: RoutePriority.FASTEST,
    });
    const fast = await service.plan(dto(), userId);
    expect(fast.sortedBy).toBe('durationAsc');
  });

  it('answers with an empty list when every source failed, without throwing', async () => {
    collectAllSources.mockResolvedValue(collected({ allSourcesFailed: true }));
    toAvailability.mockReturnValue([
      { source: 'transit', available: false, reason: 'timeout' },
      { source: 'sharedMobility', available: false, reason: 'network' },
      { source: 'cyclePaths', available: false, reason: 'internal-error' },
    ]);

    // Un état clair, pas une exception non gérée. Un 500 ferait croire à
    // l'usager que SA requête est fautive (C10).
    const result = await service.plan(dto(), userId);

    expect(result.itineraries).toEqual([]);
    expect(result.sources.every((source) => !source.available)).toBe(true);
    // Et surtout : rien n'est inventé pour meubler la réponse.
    expect(computeFootprint).not.toHaveBeenCalled();
    // L'historique décrit ce que l'usager a cherché, pas ce que nos sources ont
    // su répondre : le trajet reste à mémoriser même quand les trois se taisent.
    expect(createSearchHistory).toHaveBeenCalledTimes(1);
    expect(result.searchHistoryId).toBe('history-1');
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
    // Ni écrit : un appel mal formé n'est pas une recherche de l'usager.
    expect(createSearchHistory).not.toHaveBeenCalled();
  });

  it('records the search in the history at every call, on the JWT account (step 18)', async () => {
    const result = await service.plan(dto(), userId);

    expect(createSearchHistory).toHaveBeenCalledTimes(1);
    expect(createSearchHistory).toHaveBeenCalledWith(userId, {
      from: { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 },
      to: { label: 'Bellecour', lat: 45.757813, lng: 4.832011 },
    });
    // La ligne créée est publiée : le client n'a pas à l'enregistrer à son tour,
    // ce qui doublerait l'entrée que le serveur vient d'écrire.
    expect(result.searchHistoryId).toBe('history-1');
  });

  it('records the search without pretending an option was chosen', async () => {
    await service.plan(dto(), userId);

    // Étape 18 : aucune option n'est encore retenue. Inscrire d'office la
    // première proposition ferait passer notre classement pour un choix de
    // l'usager, et fausserait le tableau de bord carbone (C8).
    const [, payload] = createSearchHistory.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).not.toHaveProperty('selectedSummary');
    expect(payload).not.toHaveProperty('carbonGrams');
  });

  it('does not wait for the history write to start collecting the sources (C5)', async () => {
    const order: string[] = [];
    createSearchHistory.mockImplementation(() => {
      order.push('history:start');
      return Promise.resolve({ id: 'history-1' });
    });
    collectAllSources.mockImplementation(() => {
      order.push('collect');
      return Promise.resolve(collected());
    });

    await service.plan(dto(), userId);

    // L'insertion part avant la collecte et se paie donc sous la latence de la
    // source la plus lente, au lieu de s'y ajouter.
    expect(order).toEqual(['history:start', 'collect']);
  });

  it('still answers with the itineraries when the history write fails (C10)', async () => {
    createSearchHistory.mockRejectedValue(new Error('database unreachable'));

    const result = await service.plan(dto(), userId);

    // Ne pas mémoriser un trajet est un désagrément ; perdre pour cela des
    // itinéraires déjà calculés serait une régression fonctionnelle.
    expect(result.itineraries.length).toBeGreaterThan(0);
    expect(result.searchHistoryId).toBeNull();
  });
});
