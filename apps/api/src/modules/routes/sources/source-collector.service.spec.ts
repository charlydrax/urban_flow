import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type {
  CycleSegmentsResult,
  NearbyStationsResult,
  TransitJourneysResult,
} from '@urbanflow/shared';

import { CyclePathsService } from '../../transport/cycle-paths/cycle-paths.service';
import { SharedMobilityService } from '../../transport/shared-mobility.service';
import { TransitService } from '../../transport/transit.service';
import { SourceCollectorService, type RouteEndpoint } from './source-collector.service';

/**
 * Tests de l'orchestration parallèle des sources (UF-305).
 *
 * Fige les quatre critères de recette du ticket :
 *  1. les trois sources sont appelées **en parallèle** — vérifié par le temps
 *     total, qui doit rester proche de la source la plus lente et non de la
 *     somme des trois (recettes 1 et 4) ;
 *  2. une source en panne ne fait pas perdre les autres (recette 2) ;
 *  3. les trois en panne remontent un **état clair**, jamais une exception
 *     (recette 3) ;
 *  4. la source en échec est journalisée, avec sa cause.
 *
 * ## Le piège que ces tests protègent
 *
 * `TransitService` et `SharedMobilityService` ne lèvent jamais : ils rendent un
 * résultat `status: 'unavailable'`. Pour `Promise.allSettled`, ces appels sont
 * donc `fulfilled`. Une orchestration naïve les compterait comme des succès.
 * Plusieurs cas ci-dessous distinguent explicitement « a levé » de « a poliment
 * déclaré forfait » — les deux doivent finir en `failed`.
 *
 * Les horloges ne sont pas simulées ici : les faux minuteurs de Jest
 * masqueraient précisément ce qu'on veut mesurer, à savoir que les promesses
 * progressent réellement en même temps.
 */
describe('SourceCollectorService', () => {
  let service: SourceCollectorService;
  let getTransitJourneys: jest.Mock;
  let getNearbyStations: jest.Mock;
  let getCycleSegments: jest.Mock;

  const from: RouteEndpoint = { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 };
  const to: RouteEndpoint = { label: 'Bellecour', lat: 45.757813, lng: 4.832011 };
  const prefs = { reducedMobility: false };

  /** Résultat TC nominal (le moteur a répondu). */
  const transitOk = (): TransitJourneysResult => ({
    status: 'ok',
    journeys: [],
    requestedDate: '2026-08-26',
    serviceDate: '2022-05-25',
    dateAdjusted: true,
  });

  /** Résultat TC de panne — rendu SANS lever, c'est le contrat de UF-302. */
  const transitDown = (
    reason: TransitJourneysResult['unavailableReason'] = 'timeout',
  ): TransitJourneysResult => ({
    ...transitOk(),
    status: 'unavailable',
    unavailableReason: reason,
  });

  const stationsOk = (): NearbyStationsResult => ({
    status: 'ok',
    stations: [],
    radiusMeters: 500,
    publishedAt: '2026-08-26T09:14:35.000Z',
  });

  const stationsDown = (): NearbyStationsResult => ({
    status: 'unavailable',
    stations: [],
    unavailableReason: 'network',
    radiusMeters: 500,
    publishedAt: null,
  });

  const cyclesOk = (): CycleSegmentsResult => ({
    segments: [],
    radiusMeters: 300,
    datasetImportedAt: '2026-08-26T11:01:04.368Z',
  });

  /** Résout après `ms`, pour mesurer la concurrence sans simuler l'horloge. */
  const after = <T>(ms: number, value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value), ms));

  beforeEach(async () => {
    getTransitJourneys = jest.fn().mockResolvedValue(transitOk());
    getNearbyStations = jest.fn().mockResolvedValue(stationsOk());
    getCycleSegments = jest.fn().mockResolvedValue(cyclesOk());

    const moduleRef = await Test.createTestingModule({
      providers: [
        SourceCollectorService,
        { provide: TransitService, useValue: { getTransitJourneys } },
        { provide: SharedMobilityService, useValue: { getNearbyStations } },
        { provide: CyclePathsService, useValue: { getCycleSegments } },
        // Le budget de collecte est dérivé du délai d'OTP : large ici, pour que
        // seuls les tests qui le visent explicitement le déclenchent.
        { provide: ConfigService, useValue: { getOrThrow: () => 10_000 } },
      ],
    }).compile();

    service = moduleRef.get(SourceCollectorService);
    // Les pannes sont journalisées : on ne veut pas polluer la sortie de test,
    // mais on veut pouvoir vérifier qu'elles le sont (dernier bloc).
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('recette 1 & 4 — parallélisme', () => {
    it('queries the three sources concurrently, not one after the other', async () => {
      getTransitJourneys.mockReturnValue(after(150, transitOk()));
      getNearbyStations.mockReturnValue(after(150, stationsOk()));
      getCycleSegments.mockReturnValue(after(150, cyclesOk()));

      const started = Date.now();
      const collected = await service.collectAllSources(from, to, prefs);
      const elapsed = Date.now() - started;

      // En cascade, ce serait ≥ 450 ms (trois fois 150). En parallèle, ~150 ms.
      // La borne à 400 ms laisse de la marge à une CI lente tout en restant
      // très en deçà de la somme : le test échouerait sur une régression réelle.
      expect(elapsed).toBeLessThan(400);
      expect(collected.elapsedMs).toBeLessThan(400);
    });

    it('takes about as long as the slowest source, not the sum of the three', async () => {
      getTransitJourneys.mockReturnValue(after(200, transitOk()));
      getNearbyStations.mockReturnValue(after(40, stationsOk()));
      getCycleSegments.mockReturnValue(after(20, cyclesOk()));

      const collected = await service.collectAllSources(from, to, prefs);

      // Recette 4 : le total est gouverné par la plus lente.
      const slowest = Math.max(
        collected.transit.elapsedMs,
        collected.sharedMobility.elapsedMs,
        collected.cyclePaths.elapsedMs,
      );
      expect(slowest).toBe(collected.transit.elapsedMs);
      expect(collected.elapsedMs).toBeGreaterThanOrEqual(slowest);
      // Le surcoût de l'orchestration elle-même doit rester marginal.
      expect(collected.elapsedMs - slowest).toBeLessThan(100);
    });

    it('starts every source before awaiting any of them', async () => {
      // Preuve directe du parallélisme : au moment où la source la plus rapide
      // se termine, les deux autres ont déjà été appelées.
      let cycleCalledAt = 0;
      getTransitJourneys.mockReturnValue(after(120, transitOk()));
      getNearbyStations.mockReturnValue(after(120, stationsOk()));
      getCycleSegments.mockImplementation(() => {
        cycleCalledAt = Date.now();
        return Promise.resolve(cyclesOk());
      });

      const started = Date.now();
      await service.collectAllSources(from, to, prefs);

      expect(cycleCalledAt - started).toBeLessThan(100);
    });

    it('queries both endpoints of the trip for the two location-based sources', async () => {
      await service.collectAllSources(from, to, prefs);

      // Un vélo se prend à une borne ET se rend à une autre : une seule
      // extrémité ne permettrait pas de construire l'option.
      //
      // Le rayon passé est celui de la planification (plus large que le défaut
      // du connecteur) : la fusion a besoin de bornes près des **arrêts**, pas
      // seulement près de l'usager — voir `PLANNING_STATION_RADIUS_METERS`.
      expect(getNearbyStations).toHaveBeenCalledTimes(2);
      expect(getNearbyStations).toHaveBeenCalledWith(from, expect.anything());
      expect(getNearbyStations).toHaveBeenCalledWith(to, expect.anything());
      expect(getCycleSegments).toHaveBeenCalledTimes(2);
    });
  });

  describe('recette 2 — une source en panne ne fait pas perdre les autres', () => {
    it('keeps the other sources when one throws', async () => {
      getCycleSegments.mockRejectedValue(new Error('PostGIS injoignable'));

      const collected = await service.collectAllSources(from, to, prefs);

      // C'est exactement ce que `Promise.all` aurait perdu.
      expect(collected.transit.status).toBe('ok');
      expect(collected.sharedMobility.status).toBe('ok');
      expect(collected.cyclePaths.status).toBe('failed');
      expect(collected.cyclePaths.failure).toMatchObject({
        source: 'cyclePaths',
        kind: 'error',
        reason: 'PostGIS injoignable',
      });
      expect(collected.allSourcesFailed).toBe(false);
    });

    it('treats a source that politely reports unavailability as failed too', async () => {
      // Le piège : TransitService ne lève PAS, il rend status 'unavailable'.
      // Pour Promise.allSettled cet appel est `fulfilled`.
      getTransitJourneys.mockResolvedValue(transitDown('timeout'));

      const collected = await service.collectAllSources(from, to, prefs);

      expect(collected.transit.status).toBe('failed');
      expect(collected.transit.failure).toMatchObject({ kind: 'unavailable', reason: 'timeout' });
      expect(collected.sharedMobility.status).toBe('ok');
      expect(collected.cyclePaths.status).toBe('ok');
    });

    it('does not mistake an empty but successful answer for a failure', async () => {
      // « Le moteur a cherché et n'a rien trouvé » est une réponse, pas une
      // panne : la confondre afficherait « TC indisponibles » à qui habite
      // simplement hors du réseau.
      getTransitJourneys.mockResolvedValue({ ...transitOk(), journeys: [] });

      const collected = await service.collectAllSources(from, to, prefs);

      expect(collected.transit.status).toBe('ok');
      expect(collected.failures).toEqual([]);
    });

    it('keeps shared mobility usable when only one endpoint answered', async () => {
      // Les deux appels visent le même flux : une extrémité en panne et l'autre
      // non traduit une coupure passagère, pas une source morte.
      getNearbyStations.mockResolvedValueOnce(stationsOk()).mockResolvedValueOnce(stationsDown());

      const collected = await service.collectAllSources(from, to, prefs);

      expect(collected.sharedMobility.status).toBe('ok');
      expect(collected.sharedMobility.data?.destination.status).toBe('unavailable');
    });

    it('marks shared mobility failed when neither endpoint answered', async () => {
      getNearbyStations.mockResolvedValue(stationsDown());

      const collected = await service.collectAllSources(from, to, prefs);

      expect(collected.sharedMobility.status).toBe('failed');
      expect(collected.sharedMobility.failure?.kind).toBe('unavailable');
    });
  });

  describe('recette 3 — toutes les sources en panne', () => {
    it('reports a clear state instead of throwing', async () => {
      getTransitJourneys.mockResolvedValue(transitDown('network'));
      getNearbyStations.mockResolvedValue(stationsDown());
      getCycleSegments.mockRejectedValue(new Error('base indisponible'));

      // Le point du ticket : pas d'exception non gérée.
      const collected = await service.collectAllSources(from, to, prefs);

      expect(collected.allSourcesFailed).toBe(true);
      expect(collected.failures).toHaveLength(3);
      expect(collected.failures.map((failure) => failure.source)).toEqual([
        'transit',
        'sharedMobility',
        'cyclePaths',
      ]);
      expect(collected.transit.data).toBeNull();
      expect(collected.sharedMobility.data).toBeNull();
      expect(collected.cyclePaths.data).toBeNull();
    });

    it('never rejects, whatever the sources do', async () => {
      getTransitJourneys.mockRejectedValue(new Error('boom'));
      getNearbyStations.mockRejectedValue('une chaîne, pas une Error');
      getCycleSegments.mockRejectedValue(new Error('boom'));

      await expect(service.collectAllSources(from, to, prefs)).resolves.toMatchObject({
        allSourcesFailed: true,
      });
    });
  });

  describe('budget de collecte', () => {
    it('gives up on a source that has no timeout of its own', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          SourceCollectorService,
          { provide: TransitService, useValue: { getTransitJourneys } },
          { provide: SharedMobilityService, useValue: { getNearbyStations } },
          { provide: CyclePathsService, useValue: { getCycleSegments } },
          // Budget = OTP_TIMEOUT_MS + marge ; ramené très bas pour ce cas.
          { provide: ConfigService, useValue: { getOrThrow: () => 1 } },
        ],
      }).compile();
      const tight = moduleRef.get(SourceCollectorService);
      jest.spyOn(tight['logger'], 'log').mockImplementation(() => undefined);
      jest.spyOn(tight['logger'], 'warn').mockImplementation(() => undefined);

      // Une requête PostGIS bloquée sur un verrou : elle ne rendra jamais la main.
      getCycleSegments.mockReturnValue(new Promise(() => undefined));

      const collected = await tight.collectAllSources(from, to, prefs);

      expect(collected.cyclePaths.status).toBe('failed');
      expect(collected.cyclePaths.failure?.kind).toBe('timeout');
      // Et surtout : les deux autres sont bien revenues.
      expect(collected.transit.status).toBe('ok');
      expect(collected.sharedMobility.status).toBe('ok');
    });
  });

  describe('journalisation et contrat public', () => {
    it('logs which source failed and why, without any trip data (C11)', async () => {
      const warn = jest.spyOn(service['logger'], 'warn');
      const log = jest.spyOn(service['logger'], 'log');
      getTransitJourneys.mockResolvedValue(transitDown('upstream-error'));

      await service.collectAllSources(from, to, prefs);

      const warned = warn.mock.calls.flat().join(' ');
      expect(warned).toContain('transit');
      expect(warned).toContain('upstream-error');

      // Aucune ligne de log ne doit raconter où va l'usager.
      const everything = [...warn.mock.calls, ...log.mock.calls].flat().join(' ');
      expect(everything).not.toContain('Part-Dieu');
      expect(everything).not.toContain('Bellecour');
      expect(everything).not.toContain('45.760515');
    });

    it('logs the per-source timings on every search, not only on failure', async () => {
      const log = jest.spyOn(service['logger'], 'log');

      await service.collectAllSources(from, to, prefs);

      const logged = log.mock.calls.flat().join(' ');
      expect(logged).toContain('transit');
      expect(logged).toContain('sharedMobility');
      expect(logged).toContain('cyclePaths');
      expect(logged).toMatch(/3\/3 source/);
    });

    it('raises an unexpected throw to error level, a declared outage to warn', async () => {
      const warn = jest.spyOn(service['logger'], 'warn');
      const error = jest.spyOn(service['logger'], 'error');

      getTransitJourneys.mockResolvedValue(transitDown('timeout'));
      getCycleSegments.mockRejectedValue(new Error('bug de mapping'));

      await service.collectAllSources(from, to, prefs);

      // Une panne amont se gère ; une exception ne s'attend pas.
      expect(warn.mock.calls.flat().join(' ')).toContain('transit');
      expect(error.mock.calls.flat().join(' ')).toContain('cyclePaths');
    });

    it('passes the PMR preference down to the transit engine (C12)', async () => {
      await service.collectAllSources(from, to, { reducedMobility: true });

      expect(getTransitJourneys).toHaveBeenCalledWith(from, to, { wheelchair: true });
    });
  });

  describe('toAvailability', () => {
    it('reports the three sources in flow order when all answered', async () => {
      const collected = await service.collectAllSources(from, to, prefs);

      expect(service.toAvailability(collected)).toEqual([
        { source: 'transit', available: true },
        { source: 'sharedMobility', available: true },
        { source: 'cyclePaths', available: true },
      ]);
    });

    it('publishes a generic cause, never our internals (C11)', async () => {
      getTransitJourneys.mockResolvedValue(transitDown('timeout'));
      getNearbyStations.mockResolvedValue(stationsDown());
      getCycleSegments.mockRejectedValue(new Error('relation "cycle_paths" does not exist'));

      const availability = service.toAvailability(await service.collectAllSources(from, to, prefs));

      expect(availability).toEqual([
        { source: 'transit', available: false, reason: 'timeout' },
        { source: 'sharedMobility', available: false, reason: 'network' },
        { source: 'cyclePaths', available: false, reason: 'internal-error' },
      ]);
      // Le message SQL brut ne doit jamais franchir la frontière HTTP.
      expect(JSON.stringify(availability)).not.toContain('cycle_paths');
    });
  });
});
