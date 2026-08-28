import { Test } from '@nestjs/testing';

import { TransportMode } from '../../common/enums/transport-mode.enum';
import { PrismaService } from '../../prisma/prisma.service';
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
  let queryRaw: jest.Mock;

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
    // `getSummary` (UF-505) lit `search_history` en SQL brut : le mock reçoit
    // les fragments du *tagged template* puis les valeurs liées, ce qui permet
    // de vérifier séparément le texte de la requête et ses paramètres — et de
    // prouver qu'aucune donnée client n'y est concaténée (C4 / OWASP A03).
    queryRaw = jest.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [CarbonService, { provide: PrismaService, useValue: { $queryRaw: queryRaw } }],
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

  /**
   * Suivi carbone personnel (UF-505) — `getSummary`.
   *
   * Fige les critères de recette du ticket :
   *  1. la page affiche un **total** d'empreinte pour l'utilisateur connecté ;
   *  2. les données sont **propres à chaque utilisateur** — la requête est
   *     verrouillée sur l'identifiant du JWT, qu'aucun paramètre ne peut viser ;
   *  3. un **indicateur d'évolution** compare deux périodes de même durée.
   */
  describe('getSummary', () => {
    /** Instant de référence figé : les bornes de période doivent être déterministes. */
    const now = new Date('2026-08-28T12:00:00.000Z');

    /** Une tranche telle que la rend l'agrégat SQL. */
    const bucketRow = (bucket: number, overrides: Record<string, number> = {}) => ({
      bucket,
      emittedGrams: 0,
      carEquivalentGrams: 0,
      tripsCount: 0,
      unpricedCount: 0,
      ...overrides,
    });

    /** Texte SQL reconstitué (fragments du template, sans les valeurs liées). */
    const sqlOf = (call: unknown[]): string => (call[0] as string[]).join('?');

    /** Valeurs effectivement liées par PostgreSQL, dans l'ordre du template. */
    const paramsOf = (call: unknown[]): unknown[] => call.slice(1);

    it('locks the aggregate on the JWT user and nothing else', async () => {
      await service.getSummary('user-1', 30, now);

      const [call] = queryRaw.mock.calls;
      const sql = sqlOf(call);

      // Recette 2 : le périmètre de lecture est l'utilisateur du token. Aucune
      // autre clé de filtrage n'existe, donc rien à falsifier (OWASP A01).
      expect(sql).toContain('user_id = ');
      expect(paramsOf(call)).toContain('user-1');

      // L'identifiant est un paramètre lié, jamais du texte concaténé (OWASP A03).
      expect(sql).not.toContain('user-1');
    });

    it('counts only the searches on which an itinerary was actually chosen', async () => {
      await service.getSummary('user-1', 30, now);

      const sql = sqlOf(queryRaw.mock.calls[0]);

      // Un trajet ne pèse dans le bilan que si une option a été retenue :
      // additionner les suggestions du serveur gonflerait l'empreinte de
      // déplacements que personne n'a faits.
      expect(sql).toContain('FILTER (WHERE carbon_grams IS NOT NULL)');
      // Les recherches sans choix restent dénombrées à part, pour que le total
      // bas d'un compte qui cherche beaucoup s'explique.
      expect(sql).toContain('FILTER (WHERE carbon_grams IS NULL)');
    });

    it('totals the current window and compares it with the one before', async () => {
      // Quatre tranches par période : 0-3 = période précédente, 4-7 = courante.
      queryRaw.mockResolvedValue([
        bucketRow(1, { emittedGrams: 1000, carEquivalentGrams: 5000, tripsCount: 2 }),
        bucketRow(5, { emittedGrams: 300, carEquivalentGrams: 2000, tripsCount: 1 }),
        bucketRow(7, { emittedGrams: 500, carEquivalentGrams: 3000, tripsCount: 3 }),
      ]);

      const summary = await service.getSummary('user-1', 30, now);

      // Recette 1 : un total d'empreinte pour la période affichée.
      expect(summary.current.emittedGrams).toBe(800);
      expect(summary.current.tripsCount).toBe(4);
      expect(summary.previous.emittedGrams).toBe(1000);

      // Recette 3 : l'évolution est lisible et va dans le bon sens — 800 après
      // 1000, c'est une baisse de 20 %.
      expect(summary.emittedChangePercent).toBe(-20);
    });

    it('publishes the avoided CO2 as the gap with the all-car reference', async () => {
      queryRaw.mockResolvedValue([
        bucketRow(4, { emittedGrams: 1350, carEquivalentGrams: 5630, tripsCount: 1 }),
      ]);

      const summary = await service.getSummary('user-1', 30, now);

      expect(summary.current.avoidedGrams).toBe(5630 - 1350);
    });

    it('never announces a negative saving over a period', async () => {
      // Aucun mode du barème ne fait pire que la voiture solo. Le jour où il
      // s'affinera, « −40 g économisés » n'aurait aucun sens à l'écran.
      queryRaw.mockResolvedValue([
        bucketRow(4, { emittedGrams: 9000, carEquivalentGrams: 1000, tripsCount: 1 }),
      ]);

      const summary = await service.getSummary('user-1', 30, now);

      expect(summary.current.avoidedGrams).toBe(0);
    });

    it('refuses to compare against an empty previous period', async () => {
      queryRaw.mockResolvedValue([bucketRow(5, { emittedGrams: 400, tripsCount: 1 })]);

      const summary = await service.getSummary('user-1', 30, now);

      // Un compte neuf n'a pas « augmenté de l'infini » : il n'a rien à
      // comparer, et l'écran doit pouvoir le dire avec des mots.
      expect(summary.emittedChangePercent).toBeNull();
    });

    it('returns a full series of zeroed buckets when nothing was recorded', async () => {
      queryRaw.mockResolvedValue([]);

      const summary = await service.getSummary('user-1', 30, now);

      // Le graphique doit tracer quatre barres nulles plutôt que disparaître :
      // une période vide est une information, pas une absence de réponse.
      expect(summary.buckets).toHaveLength(4);
      expect(summary.buckets.every((bucket) => bucket.emittedGrams === 0)).toBe(true);
      expect(summary.current.tripsCount).toBe(0);
      expect(summary.unpricedTripsCount).toBe(0);
    });

    it('cuts the requested window into four contiguous buckets', async () => {
      const summary = await service.getSummary('user-1', 30, now);

      // La période courante se termine à l'instant de l'appel et couvre
      // exactement `days` jours : c'est une fenêtre glissante, pas un mois
      // calendaire — sinon l'évolution affichée un 1er du mois ne voudrait rien
      // dire.
      expect(summary.current.to).toBe(now.toISOString());
      expect(
        new Date(summary.current.to).getTime() - new Date(summary.current.from).getTime(),
      ).toBe(30 * 24 * 60 * 60 * 1000);

      // Les tranches se touchent sans trou ni recouvrement, et couvrent
      // exactement la période affichée.
      expect(summary.buckets[0]?.from).toBe(summary.current.from);
      expect(summary.buckets[3]?.to).toBe(summary.current.to);
      expect(summary.buckets[1]?.from).toBe(summary.buckets[0]?.to);

      // La période précédente est sa jumelle immédiate : deux durées
      // identiques, donc une comparaison qui a un sens.
      expect(summary.previous.to).toBe(summary.current.from);
    });

    it('reports the searches left without a chosen itinerary', async () => {
      queryRaw.mockResolvedValue([
        bucketRow(4, { emittedGrams: 200, tripsCount: 1, unpricedCount: 2 }),
        // Une recherche non valorisée de la période PRÉCÉDENTE ne doit pas
        // remonter : l'écran explique le total qu'il affiche, pas un autre.
        bucketRow(0, { unpricedCount: 7 }),
      ]);

      const summary = await service.getSummary('user-1', 30, now);

      expect(summary.unpricedTripsCount).toBe(2);
    });
  });
});
