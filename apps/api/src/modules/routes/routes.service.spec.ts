import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RoutePriority, TransportMode } from '@urbanflow/shared';

import { CarbonService } from '../carbon/carbon.service';
import { SearchHistoryService } from '../search-history/search-history.service';
import {
  StreetRoutingService,
  streetPathKey,
  type StreetPathQuery,
} from '../transport/street-routing.service';
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
  /** Ce que les faux du Service Carbone regardent d'un segment, et rien de plus. */
  type StubSegment = { mode: TransportMode; line?: string };

  let service: RoutesService;
  let getPreferences: jest.Mock;
  let collectAllSources: jest.Mock;
  let toAvailability: jest.Mock;
  let computeFootprint: jest.Mock;
  let createSearchHistory: jest.Mock;
  let routePaths: jest.Mock;

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

  /**
   * Une empreinte de la forme rendue par le Service Carbone, à total imposé.
   *
   * Le total est **réparti** sur les lignes plutôt que posé à côté d'elles :
   * l'orchestrateur réécrit les `carbonGrams` des segments avec ces lignes, et
   * un faux dont le total ne serait pas la somme du détail testerait une
   * réponse que le vrai service ne peut pas produire.
   */
  const footprint = (segments: StubSegment[], totalGrams: number) => {
    const share = Math.round(totalGrams / Math.max(1, segments.length));
    const detail = segments.map((segment, index) => ({
      mode: segment.mode,
      distanceMeters: 1000,
      factorGramsPerKm: 42,
      // Le dernier absorbe l'arrondi : le total reste la somme exacte des lignes.
      grams: index === segments.length - 1 ? totalGrams - share * (segments.length - 1) : share,
    }));

    return {
      totalGrams,
      segments: detail,
      carEquivalentGrams: 218,
      avoidedGrams: Math.max(0, 218 - totalGrams),
    };
  };

  /**
   * Collecte TC à **deux** trajets, dont le second est plus long.
   *
   * La fusion les classera donc dans cet ordre sur la durée, et sur l'empreinte
   * qu'elle en déduit. C'est ce qui rend observable le reclassement d'UF-502 :
   * avec un seul itinéraire, aucun tri ne se distingue de l'absence de tri.
   */
  const twoJourneys = () => {
    const base = collected().transit as { data: { journeys: unknown[] } };
    const [first] = base.data.journeys as Record<string, unknown>[];
    const firstLeg = (first?.legs as Record<string, unknown>[])[0];

    return {
      ...base,
      data: {
        ...base.data,
        journeys: [
          first,
          {
            ...first,
            id: 'transit-2',
            durationMinutes: 19,
            arrivalAt: '2026-08-26T08:19:00+02:00',
            legs: [
              {
                ...firstLeg,
                mode: TransportMode.TRAM,
                sourceMode: 'TRAM',
                durationMinutes: 19,
                distanceMeters: 2600,
                line: 'T1',
                arrivalAt: '2026-08-26T08:19:00+02:00',
              },
            ],
          },
        ],
      },
    } as unknown as CollectedSources['transit'];
  };

  beforeEach(async () => {
    getPreferences = jest.fn().mockResolvedValue(DEFAULT_PREFERENCES);
    collectAllSources = jest.fn().mockResolvedValue(collected());
    toAvailability = jest.fn().mockReturnValue([
      { source: 'transit', available: true },
      { source: 'sharedMobility', available: true },
      { source: 'cyclePaths', available: true },
    ]);
    // Depuis UF-501 le Service Carbone rend un objet : total, détail par
    // segment et référence voiture. Le faux en reproduit la forme — ce que
    // l'orchestrateur en fait (publier le total, réécrire les segments) ne se
    // teste pas sur un nombre nu.
    computeFootprint = jest.fn().mockImplementation((segments: { mode: TransportMode }[]) => ({
      totalGrams: 42,
      segments: segments.map((segment) => ({
        mode: segment.mode,
        distanceMeters: 1000,
        factorGramsPerKm: 42,
        grams: 42,
      })),
      carEquivalentGrams: 218,
      avoidedGrams: 176,
    }));
    createSearchHistory = jest.fn().mockResolvedValue({ id: 'history-1' });
    // UF-702 : par défaut le routeur de voirie ne rend aucun cheminement — les
    // segments gardent alors leur droite, c'est-à-dire le comportement d'avant
    // le ticket. Les tests qui portent sur le tracé le font parler eux-mêmes.
    routePaths = jest.fn().mockResolvedValue(new Map());

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoutesService,
        { provide: UsersService, useValue: { getPreferences } },
        { provide: SourceCollectorService, useValue: { collectAllSources, toAvailability } },
        { provide: CarbonService, useValue: { computeFootprint } },
        { provide: SearchHistoryService, useValue: { create: createSearchHistory } },
        { provide: StreetRoutingService, useValue: { routePaths } },
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

  it('publishes the profile constraints that narrowed the list (UF-602, C7/C12)', async () => {
    getPreferences.mockResolvedValue({ ...DEFAULT_PREFERENCES, reducedMobility: true });

    const result = await service.plan(dto(), userId);

    // Le client ne peut pas déduire ce filtre : il ne voit que le résultat.
    // Sans cette publication, une liste réduite — voire vide — reste
    // inexplicable à l'écran.
    expect(result.appliedConstraints).toEqual({ reducedMobility: true });
  });

  it('publishes the constraints even when every source went silent (UF-602)', async () => {
    getPreferences.mockResolvedValue({ ...DEFAULT_PREFERENCES, reducedMobility: true });
    collectAllSources.mockResolvedValue({ ...collected(), allSourcesFailed: true });

    const result = await service.plan(dto(), userId);

    // La sortie anticipée est le cas où l'information manque le plus : liste
    // vide, aucune source, et un filtre actif que rien d'autre ne dirait.
    expect(result.itineraries).toHaveLength(0);
    expect(result.appliedConstraints).toEqual({ reducedMobility: true });
  });

  it('says « no constraint » rather than staying silent on a default profile (UF-602)', async () => {
    const result = await service.plan(dto(), userId);

    // Le champ est toujours présent : c'est son absence qui signale au client
    // une réponse rendue par un cache antérieur au ticket.
    expect(result.appliedConstraints).toEqual({ reducedMobility: false });
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
    // Les segments *publiés* ne sont plus ceux qui ont été passés au service :
    // depuis UF-501 leur `carbonGrams` est réécrit avec la réponse. La
    // comparaison porte donc sur ce qui identifie un segment — son mode et sa
    // distance — et non sur l'objet entier.
    expect(computeFootprint).toHaveBeenCalledWith(
      result.itineraries[0]?.segments.map((segment) =>
        expect.objectContaining({ mode: segment.mode, distanceMeters: segment.distanceMeters }),
      ),
    );
    // Le barème appartient au Service Carbone : la fusion ne fait qu'estimer
    // pour classer ses candidats, c'est cette valeur-ci qui est publiée.
    expect(result.itineraries.every((itinerary) => itinerary.carbonGrams === 42)).toBe(true);
  });

  it('publishes the per-segment breakdown, and lets it overwrite what the merge guessed (UF-501)', async () => {
    const result = await service.plan(dto(), userId);
    const [itinerary] = result.itineraries;

    // Le détail accompagne le total : c'est lui qui rend le chiffre
    // vérifiable à l'écran, ligne par ligne.
    expect(itinerary?.carbon?.totalGrams).toBe(itinerary?.carbonGrams);
    expect(itinerary?.carbon?.segments).toHaveLength(itinerary?.segments.length ?? 0);
    expect(itinerary?.carbon?.carEquivalentGrams).toBe(218);

    // Et les segments publiés portent la valeur du service, pas celle que la
    // fusion avait estimée : deux chiffres pour la même chose finiraient par
    // diverger, et c'est le service qui fait foi.
    expect(itinerary?.segments.every((segment) => segment.carbonGrams === 42)).toBe(true);
  });

  it('sorts the published list on the published footprint, not on the merge guess (UF-502)', async () => {
    // Deux propositions, et un Service Carbone qui contredit l'estimation de la
    // fusion : le second trajet — plus long, donc classé après par la fusion —
    // est ici le moins émetteur. C'est le seul moyen de vérifier que l'ordre
    // suit bien les nombres publiés et non ceux qui ont servi à les choisir.
    collectAllSources.mockResolvedValue(collected({ transit: twoJourneys() }));
    computeFootprint.mockImplementation((segments: StubSegment[]) => {
      const heavy = segments.some((segment) => segment.line === 'B');
      return footprint(segments, heavy ? 900 : 100);
    });

    const result = await service.plan(dto(), userId);

    expect(result.itineraries.length).toBeGreaterThan(1);
    expect(result.sortedBy).toBe('carbonAsc');
    // `sortedBy` est une promesse : le client annonce « classés par empreinte »
    // sans revérifier. La liste doit donc l'être sur les valeurs qu'elle porte.
    const published = result.itineraries.map((itinerary) => itinerary.carbonGrams);
    expect(published).toEqual([...published].sort((a, b) => a - b));
    expect(published[0]).toBe(100);
  });

  it('keeps the duration order when the profile asks for the fastest (UF-502)', async () => {
    // Le reclassement ne doit pas s'appliquer au-delà de sa raison d'être :
    // sur un profil « rapide », l'empreinte n'est qu'un départage, et une
    // valorisation carbone ne doit pas réordonner la liste par durée.
    getPreferences.mockResolvedValue({ ...DEFAULT_PREFERENCES, priority: RoutePriority.FASTEST });
    collectAllSources.mockResolvedValue(collected({ transit: twoJourneys() }));
    computeFootprint.mockImplementation((segments: StubSegment[]) =>
      footprint(segments, segments.some((segment) => segment.line === 'B') ? 900 : 100),
    );

    const result = await service.plan(dto(), userId);

    expect(result.sortedBy).toBe('durationAsc');
    const durations = result.itineraries.map((itinerary) => itinerary.durationMinutes);
    expect(durations).toEqual([...durations].sort((a, b) => a - b));
  });

  it('prices every itinerary in a negligible share of the response time (UF-502)', async () => {
    // Recette d'UF-502 : « le temps de réponse reste acceptable après ajout du
    // calcul ». La collecte des trois sources se compte en centaines de
    // millisecondes (voir docs/source-orchestration.md) ; la valorisation, elle,
    // est une arithmétique en mémoire sur au plus cinq itinéraires. Le budget
    // ci-dessous est délibérément lâche — il n'est pas là pour mesurer la
    // machine de CI, mais pour faire échouer la construction le jour où
    // quelqu'un glisserait une I/O dans le Service Carbone.
    collectAllSources.mockResolvedValue(collected({ transit: twoJourneys() }));

    const startedAt = performance.now();
    const result = await service.plan(dto(), userId);
    const elapsedMs = performance.now() - startedAt;

    expect(result.itineraries.length).toBeGreaterThan(0);
    expect(computeFootprint).toHaveBeenCalledTimes(result.itineraries.length);
    // Une seule passe par itinéraire : ni recalcul par segment affiché, ni
    // second appel pour le tri.
    expect(elapsedMs).toBeLessThan(50);
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

  it('publishes the carbon order by default, so the greener option is read first (UF-503)', async () => {
    // Recette 1 d'UF-503 : « les itinéraires sont affichés du moins au plus
    // émetteur par défaut ». Le défaut est celui d'un compte qui n'a jamais
    // touché à ses préférences — `DEFAULT_PREFERENCES`, priorité « écolo ».
    //
    // Ce test verrouille le lien entre ce défaut produit et l'ordre publié. Le
    // jour où quelqu'un passerait `DEFAULT_PREFERENCES.priority` à `FASTEST`
    // pour raccourcir une démo, la liste s'ouvrirait sur l'option la plus
    // rapide et le choix de conception du ticket tomberait sans bruit.
    getPreferences.mockResolvedValue(DEFAULT_PREFERENCES);
    collectAllSources.mockResolvedValue(collected({ transit: twoJourneys() }));
    computeFootprint.mockImplementation((segments: StubSegment[]) =>
      footprint(segments, segments.some((segment) => segment.line === 'B') ? 900 : 100),
    );

    const result = await service.plan(dto(), userId);

    expect(result.sortedBy).toBe('carbonAsc');
    expect(result.itineraries[0]?.carbonGrams).toBe(
      Math.min(...result.itineraries.map((itinerary) => itinerary.carbonGrams)),
    );
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
  describe('visiteur non connecté (UF-801)', () => {
    it('serves a guest without ever touching the profile table (C5)', async () => {
      const result = await service.plan(dto(), null);

      // Aucun compte, donc aucun profil à lire : interroger la base avec un
      // identifiant nul coûterait un aller-retour pour se voir rendre les
      // défauts qu'on connaît déjà.
      expect(getPreferences).not.toHaveBeenCalled();
      expect(result.itineraries.length).toBeGreaterThan(0);
    });

    it('applies the default preferences to a guest', async () => {
      const result = await service.plan(dto(), null);

      // Le défaut « écolo » vaut pour tout le monde : un invité obtient le même
      // classement qu'un compte neuf, et la même absence de filtre PMR.
      expect(result.sortedBy).toBe('carbonAsc');
      expect(result.appliedConstraints).toEqual({ reducedMobility: false });
    });

    it('never records a guest search (C8 — minimisation)', async () => {
      const result = await service.plan(dto(), null);

      // Un historique anonyme n'aurait aucun lecteur : conserver un déplacement
      // que personne ne pourra consulter est une collecte sans finalité.
      expect(createSearchHistory).not.toHaveBeenCalled();
      expect(result.searchHistoryId).toBeNull();
    });

    it('gives a guest the same calculation as a signed-in user, not a degraded one', async () => {
      const guest = await service.plan(dto(), null);
      const member = await service.plan(dto(), userId);

      // Seule la mémoire diffère. Les itinéraires, leur ordre et leur empreinte
      // sont ceux du même calcul : il n'existe pas de planificateur au rabais.
      expect(guest.itineraries).toEqual(member.itineraries);
      expect(guest.sortedBy).toBe(member.sortedBy);
      expect(collectAllSources).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), {
        reducedMobility: false,
      });
    });

    it('does not hand out the shared DEFAULT_PREFERENCES object', async () => {
      // `DEFAULT_PREFERENCES` est un objet de module : si le service en rendait
      // la référence, ce chemin serait le seul par lequel un défaut global
      // pourrait être modifié — pour tous les invités suivants.
      const snapshot = JSON.parse(JSON.stringify(DEFAULT_PREFERENCES)) as unknown;

      await service.plan(dto(), null);

      expect(DEFAULT_PREFERENCES).toEqual(snapshot);
    });
  });

  // ------------------------------- UF-804 : options de recherche de l'écran

  describe('options de recherche du planificateur (UF-804)', () => {
    it('descend l’heure de départ demandée jusqu’à la collecte', async () => {
      await service.plan(dto({ departAt: '2026-09-01T08:30:00+02:00' }), userId);

      expect(collectAllSources).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        reducedMobility: false,
        departureAt: '2026-09-01T08:30:00+02:00',
      });
    });

    it('n’envoie aucune date quand la chip est restée sur « Maintenant »', async () => {
      // Le connecteur a son propre défaut (« maintenant ») : le redoubler ici
      // ferait figer l'instant au moment où le service construit sa requête,
      // et non au moment où le moteur la traite.
      await service.plan(dto(), userId);

      expect(collectAllSources).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        reducedMobility: false,
      });
    });

    it('publie les modes écartés, jamais la marche', async () => {
      const result = await service.plan(
        dto({ modes: [TransportMode.WALK, TransportMode.BIKE, TransportMode.METRO] }),
        userId,
      );

      expect(result.appliedConstraints.excludedModes).toEqual(
        expect.arrayContaining([TransportMode.BUS, TransportMode.TRAM, TransportMode.SCOOTER]),
      );
      // La marche reste praticable quoi qu'il arrive (`usesOnlySelectedModes`) :
      // l'annoncer exclue serait une contrainte affichée qui n'agit pas.
      expect(result.appliedConstraints.excludedModes).not.toContain(TransportMode.WALK);
    });

    it('ne publie aucune exclusion quand tous les modes sont cochés', async () => {
      const result = await service.plan(dto({ modes: Object.values(TransportMode) }), userId);

      expect(result.appliedConstraints.excludedModes).toBeUndefined();
    });

    it('ne publie la taille du groupe que lorsqu’elle contraint', async () => {
      const alone = await service.plan(dto({ travellers: 1 }), userId);
      const group = await service.plan(dto({ travellers: 4 }), userId);

      // Un voyageur seul n'a rien retiré : l'annoncer ferait chercher une
      // explication là où il n'y en a pas.
      expect(alone.appliedConstraints.travellers).toBeUndefined();
      expect(group.appliedConstraints.travellers).toBe(4);
    });

    it('laisse `appliedConstraints` intact quand l’écran n’envoie aucune option', async () => {
      const result = await service.plan(dto(), userId);

      expect(result.appliedConstraints).toEqual({ reducedMobility: false });
    });
  });

  /**
   * Recette UF-702 : les segments marche et vélo sortent de la fusion en ligne
   * droite ; l'orchestrateur va chercher leur cheminement réel — sauf quand il
   * vient d'apprendre que le moteur ne répond pas.
   */
  describe('tracés de voirie (UF-702)', () => {
    /** Le trajet de référence, précédé d'une marche d'accès à l'arrêt. */
    const withWalkLeg = () => {
      const transit = collected().transit as unknown as {
        data: { journeys: Record<string, unknown>[] };
      };
      const [journey] = transit.data.journeys;
      const legs = (journey?.legs ?? []) as Record<string, unknown>[];

      return collected({
        transit: {
          ...transit,
          data: {
            ...transit.data,
            journeys: [
              {
                ...journey,
                legs: [
                  {
                    mode: TransportMode.WALK,
                    sourceMode: 'WALK',
                    transit: false,
                    from: { name: 'Part-Dieu', lat: 45.760515, lng: 4.859057 },
                    to: { name: 'Part-Dieu métro', lat: 45.7602, lng: 4.8585 },
                    durationMinutes: 3,
                    distanceMeters: 240,
                    accessible: true,
                  },
                  ...legs,
                ],
              },
            ],
          },
        },
      } as unknown as Partial<CollectedSources>);
    };

    it("n'appelle pas le routeur quand aucun segment n'est à router (C5)", async () => {
      // La collecte de référence ne rend qu'un métro : sa forme vient du GTFS,
      // il n'y a rien à demander à la voirie. Un aller-retour à vide serait
      // payé à chaque recherche.
      await service.plan(dto(), userId);

      expect(routePaths).not.toHaveBeenCalled();
    });

    it('demande le cheminement des segments de voirie encore droits', async () => {
      collectAllSources.mockResolvedValue(withWalkLeg());

      await service.plan(dto(), userId);

      expect(routePaths).toHaveBeenCalledTimes(1);
      const [queries] = routePaths.mock.calls[0] as [{ mode: TransportMode }[]];
      expect(queries.length).toBeGreaterThan(0);
      expect(queries.every((query) => query.mode === TransportMode.WALK)).toBe(true);
    });

    it('trace quand même la voirie si la source TC a échoué (BUG-003)', async () => {
      // Le contraire du comportement d'avant BUG-003. Un `plan` TC qui expire
      // ne dit rien du réseau piéton : renoncer au tracé pour cette raison
      // faisait varier l'affichage d'un même trajet au gré de la charge du
      // moteur. C'est au `StreetRoutingService` de renoncer, s'il constate
      // lui-même le silence.
      collectAllSources.mockResolvedValue(
        collected({
          transit: {
            status: 'failed',
            data: null,
            elapsedMs: 2000,
            failure: { source: 'transit', kind: 'timeout', reason: 'timeout' },
          },
        } as Partial<CollectedSources>),
      );

      // Trajet court : reste la marche seule, entièrement synthétisée par la
      // fusion — exactement le tracé que la production dessinait à travers les
      // immeubles.
      await service.plan(dto({ to: { label: 'Saxe-Gambetta', lat: 45.755, lng: 4.8555 } }), userId);

      expect(routePaths).toHaveBeenCalledTimes(1);
      const [queries] = routePaths.mock.calls[0] as [{ mode: TransportMode }[]];
      expect(queries.every((query) => query.mode === TransportMode.WALK)).toBe(true);
    });

    it('publie le tracé routé et son marquage jusque dans la réponse (C6)', async () => {
      collectAllSources.mockResolvedValue(withWalkLeg());
      routePaths.mockImplementation((queries: StreetPathQuery[]) =>
        Promise.resolve(
          new Map(
            queries.map((query) => [
              streetPathKey(query),
              {
                type: 'LineString' as const,
                coordinates: [
                  [4.859057, 45.760515],
                  [4.8588, 45.7604],
                  [4.8585, 45.7602],
                ] as [number, number][],
              },
            ]),
          ),
        ),
      );

      const result = await service.plan(dto(), userId);
      const segments = result.itineraries.flatMap((itinerary) => itinerary.segments);
      const walk = segments.find((segment) => segment.mode === TransportMode.WALK);

      expect(walk?.geometrySource).toBe('routed');
      expect(walk?.geometry?.coordinates.length).toBeGreaterThan(2);
      // Le métro n'a pas de forme GTFS dans ce faux : il reste droit, et le dit.
      expect(segments.find((segment) => segment.mode === TransportMode.METRO)?.geometrySource).toBe(
        'straight',
      );
    });
  });
});
