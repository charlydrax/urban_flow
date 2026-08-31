import {
  CycleFacilityType,
  type CycleSegment,
  type SharedMobilityStation,
  type TransitJourney,
  type TransitLeg,
} from '@urbanflow/shared';

import { RoutePriority } from '../../../common/enums/route-priority.enum';
import { TransportMode } from '../../../common/enums/transport-mode.enum';
import type { CollectedSources } from '../sources/collected-sources';
import {
  MAX_ITINERARIES,
  mergeIntoItineraries,
  type MergeEndpoint,
  type MergePreferences,
} from './itinerary-merger';

/**
 * Recette du ticket UF-401, sur le scénario nominal du projet
 * (Part-Dieu → Bellecour, CLAUDE.md §1).
 *
 * Les quatre points de recette y sont couverts explicitement :
 *  1. plusieurs itinéraires multimodaux **distincts** ;
 *  2. chaque itinéraire est une **chaîne continue** (aucun trou géographique) ;
 *  3. les **préférences** du profil changent les propositions (deux profils) ;
 *  4. le nombre d'itinéraires est **plafonné**.
 *
 * La fusion étant une fonction pure, tout se joue sur des données figées : ni
 * OTP, ni flux GBFS, ni PostGIS ne sont sollicités. C'est précisément ce qui
 * rend l'algorithme — le cœur du produit — vérifiable en soutenance.
 */
describe('mergeIntoItineraries', () => {
  /** Départ du scénario nominal. */
  const PART_DIEU: MergeEndpoint = { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 };
  /** Arrivée du scénario nominal, à environ 2,1 km de vol d'oiseau. */
  const BELLECOUR: MergeEndpoint = { label: 'Bellecour', lat: 45.757813, lng: 4.832011 };

  const DEFAULT_PREFS: MergePreferences = {
    preferredModes: [TransportMode.WALK, TransportMode.METRO, TransportMode.BIKE],
    priority: RoutePriority.GREENEST,
    reducedMobility: false,
    maxWalkMinutes: 15,
    // UF-804 : le voyageur seul est le cas courant, et la valeur pour laquelle
    // la fusion se comporte exactement comme avant le ticket.
    travellers: 1,
  };

  const prefs = (overrides: Partial<MergePreferences> = {}): MergePreferences => ({
    ...DEFAULT_PREFS,
    ...overrides,
  });

  // ------------------------------------------------------------- fabriques

  const place = (name: string, lat: number, lng: number, stopId?: string) => ({
    name,
    lat,
    lng,
    ...(stopId ? { stopId } : {}),
  });

  const leg = (
    overrides: Partial<TransitLeg> & Pick<TransitLeg, 'mode' | 'from' | 'to'>,
  ): TransitLeg => ({
    sourceMode: overrides.mode,
    transit: overrides.mode !== TransportMode.WALK,
    departureAt: '2026-08-26T08:00:00+02:00',
    arrivalAt: '2026-08-26T08:15:00+02:00',
    durationMinutes: 5,
    distanceMeters: 500,
    accessible: true,
    ...overrides,
  });

  /**
   * Trajet TC de référence : une longue marche d'accès (15 min), un métro, une
   * courte marche de sortie. C'est la marche d'accès qui rend le rabattement à
   * vélo intéressant — et c'est le cas d'usage que le ticket cible.
   */
  const journey = (overrides: Partial<TransitJourney> = {}): TransitJourney => ({
    id: 'transit-1',
    departureAt: '2026-08-26T08:00:00+02:00',
    arrivalAt: '2026-08-26T08:23:00+02:00',
    durationMinutes: 23,
    walkDistanceMeters: 1300,
    transfers: 0,
    accessible: true,
    legs: [
      leg({
        mode: TransportMode.WALK,
        from: place('Origin', PART_DIEU.lat, PART_DIEU.lng),
        to: place('Saxe-Gambetta', 45.7565, 4.848, 'TCL:1234'),
        durationMinutes: 15,
        distanceMeters: 1200,
      }),
      leg({
        mode: TransportMode.METRO,
        from: place('Saxe-Gambetta', 45.7565, 4.848, 'TCL:1234'),
        to: place('Bellecour', 45.7578, 4.8325, 'TCL:5678'),
        durationMinutes: 6,
        distanceMeters: 2000,
        line: 'B',
      }),
      leg({
        mode: TransportMode.WALK,
        from: place('Bellecour', 45.7578, 4.8325, 'TCL:5678'),
        to: place('Destination', BELLECOUR.lat, BELLECOUR.lng),
        durationMinutes: 2,
        distanceMeters: 100,
      }),
    ],
    ...overrides,
  });

  const station = (
    overrides: Partial<SharedMobilityStation> &
      Pick<SharedMobilityStation, 'id' | 'name' | 'lat' | 'lng'>,
  ): SharedMobilityStation => ({
    distanceMeters: 0,
    capacity: 20,
    vehiclesAvailable: 8,
    vehicles: [{ mode: TransportMode.BIKE, electric: false, count: 8 }],
    docksAvailable: 12,
    renting: true,
    returning: true,
    lastReportedAt: '2026-08-26T07:59:00+02:00',
    ...overrides,
  });

  /** Borne devant le départ. */
  const VILLETTE = station({ id: '1001', name: 'PART-DIEU / VILLETTE', lat: 45.7604, lng: 4.8598 });
  /** Borne au pied de l'arrêt d'embarquement — la clé du rabattement. */
  const GAMBETTA = station({ id: '1002', name: 'SAXE / GAMBETTA', lat: 45.7567, lng: 4.8483 });
  /** Borne devant l'arrivée. */
  const BELLECOUR_STATION = station({
    id: '2001',
    name: 'BELLECOUR / RÉPUBLIQUE',
    lat: 45.758,
    lng: 4.8325,
  });

  /** Arrivée courte : environ 1,3 km, de quoi rendre la marche seule crédible. */
  const GUILLOTIERE: MergeEndpoint = { label: 'Guillotière', lat: 45.7578, lng: 4.8425 };
  /** Borne devant cette arrivée courte. */
  const GUILLOTIERE_STATION = station({
    id: '3001',
    name: 'GUILLOTIÈRE / GRANDE RUE',
    lat: 45.7576,
    lng: 4.8428,
  });

  /** Même trajet TC, mais vers l'arrivée courte — les quatre familles deviennent constructibles. */
  const shortJourney = (id: string, line: string, mode = TransportMode.METRO): TransitJourney =>
    journey({
      id,
      legs: [
        leg({
          mode: TransportMode.WALK,
          from: place('Origin', PART_DIEU.lat, PART_DIEU.lng),
          to: place('Saxe-Gambetta', 45.7565, 4.848, 'TCL:1234'),
          durationMinutes: 15,
          distanceMeters: 1200,
        }),
        leg({
          mode,
          from: place('Saxe-Gambetta', 45.7565, 4.848, 'TCL:1234'),
          to: place('Guillotière', 45.758, 4.843, 'TCL:9012'),
          durationMinutes: 4,
          distanceMeters: 700,
          line,
        }),
        leg({
          mode: TransportMode.WALK,
          from: place('Guillotière', 45.758, 4.843, 'TCL:9012'),
          to: place('Destination', GUILLOTIERE.lat, GUILLOTIERE.lng),
          durationMinutes: 1,
          distanceMeters: 60,
        }),
      ],
    });

  const cycleSegment = (id: string, coordinates: [number, number][]): CycleSegment => ({
    id,
    name: 'Rue Garibaldi',
    facilityType: CycleFacilityType.CYCLE_TRACK,
    sourceFacilityType: 'Piste Cyclable',
    network: 'Voies Lyonnaises',
    surface: 'Enrobé',
    distanceMeters: 10,
    lengthMeters: 800,
    geometry: { type: 'MultiLineString', coordinates: [coordinates] },
  });

  /**
   * Collecte nominale : les trois sources ont répondu.
   *
   * Chaque source est surchargeable indépendamment — c'est ce qui permet de
   * vérifier la dégradation gracieuse source par source (C10).
   */
  const sources = (
    options: {
      journeys?: TransitJourney[];
      originStations?: SharedMobilityStation[];
      destinationStations?: SharedMobilityStation[];
      cycleSegments?: CycleSegment[];
      transitFailed?: boolean;
      sharedMobilityFailed?: boolean;
      cyclePathsFailed?: boolean;
    } = {},
  ): CollectedSources => {
    const {
      journeys = [journey()],
      originStations = [VILLETTE, GAMBETTA],
      destinationStations = [BELLECOUR_STATION],
      cycleSegments = [],
      transitFailed = false,
      sharedMobilityFailed = false,
      cyclePathsFailed = false,
    } = options;

    const failed = <T>(source: 'transit' | 'sharedMobility' | 'cyclePaths') =>
      ({
        status: 'failed' as const,
        data: null,
        elapsedMs: 0,
        failure: { source, kind: 'unavailable' as const, reason: 'test' },
      }) satisfies { status: 'failed'; data: T | null; elapsedMs: number; failure: unknown };

    return {
      transit: transitFailed
        ? failed('transit')
        : {
            status: 'ok',
            elapsedMs: 120,
            data: {
              status: 'ok',
              journeys,
              requestedDate: '2026-08-26',
              serviceDate: '2022-09-01',
              dateAdjusted: true,
            },
          },
      sharedMobility: sharedMobilityFailed
        ? failed('sharedMobility')
        : {
            status: 'ok',
            elapsedMs: 60,
            data: {
              origin: {
                status: 'ok',
                stations: originStations,
                radiusMeters: 900,
                publishedAt: '2026-08-26T07:59:00+02:00',
              },
              destination: {
                status: 'ok',
                stations: destinationStations,
                radiusMeters: 900,
                publishedAt: '2026-08-26T07:59:00+02:00',
              },
            },
          },
      cyclePaths: cyclePathsFailed
        ? failed('cyclePaths')
        : {
            status: 'ok',
            elapsedMs: 8,
            data: {
              origin: { segments: cycleSegments, radiusMeters: 300, datasetImportedAt: null },
              destination: { segments: [], radiusMeters: 300, datasetImportedAt: null },
            },
          },
      failures: [],
      allSourcesFailed: false,
      elapsedMs: 130,
    } as CollectedSources;
  };

  // -------------------------------------------------------------- recette 1

  it('proposes several distinct multimodal itineraries for a Lyon trip', () => {
    const { itineraries } = mergeIntoItineraries(sources(), PART_DIEU, BELLECOUR, prefs());

    expect(itineraries.length).toBeGreaterThanOrEqual(3);

    // « Distincts » ne veut pas dire « au nombre de trois » mais « qui ne se
    // ressemblent pas » : trois variantes du même métro ne sont pas trois choix.
    const summaries = itineraries.map((itinerary) => itinerary.summary);
    expect(new Set(summaries).size).toBe(summaries.length);

    // Les trois familles attendues du ticket sont représentées.
    expect(itineraries.map((itinerary) => itinerary.id).sort()).toEqual([
      'bike',
      'bike-transit',
      'transit-1',
    ]);
  });

  it('builds the bike feeder out of a real docking station near the boarding stop', () => {
    const { itineraries } = mergeIntoItineraries(sources(), PART_DIEU, BELLECOUR, prefs());
    const feeder = itineraries.find((itinerary) => itinerary.id === 'bike-transit');

    expect(feeder).toBeDefined();
    expect(feeder?.segments.map((segment) => segment.mode)).toEqual([
      TransportMode.WALK,
      TransportMode.BIKE,
      TransportMode.WALK,
      TransportMode.METRO,
      TransportMode.WALK,
    ]);
    // Le vélo est rendu à la borne de l'arrêt, pas abandonné sur le trottoir.
    expect(feeder?.segments[1]?.to).toBe('SAXE / GAMBETTA');
    // Et le rabattement fait bien gagner du temps sur le tout-TC.
    const transitOnly = itineraries.find((itinerary) => itinerary.id === 'transit-1');
    expect(feeder?.durationMinutes).toBeLessThan(transitOnly?.durationMinutes ?? 0);
  });

  // -------------------------------------------------------------- recette 2

  it('chains every itinerary end to end, with no geographic hole', () => {
    const { itineraries } = mergeIntoItineraries(sources(), PART_DIEU, BELLECOUR, prefs());

    for (const itinerary of itineraries) {
      expect(itinerary.segments.length).toBeGreaterThan(0);
      expect(itinerary.segments[0]?.from).toBe(PART_DIEU.label);
      expect(itinerary.segments[itinerary.segments.length - 1]?.to).toBe(BELLECOUR.label);

      for (let index = 0; index < itinerary.segments.length - 1; index += 1) {
        expect(itinerary.segments[index]?.to).toBe(itinerary.segments[index + 1]?.from);
      }
    }
  });

  it('publishes one continuous GeoJSON LineString per itinerary (C9)', () => {
    const { itineraries } = mergeIntoItineraries(sources(), PART_DIEU, BELLECOUR, prefs());

    for (const itinerary of itineraries) {
      expect(itinerary.geometry?.type).toBe('LineString');
      // Une LineString valide au sens de la RFC 7946 exige au moins deux points.
      expect(itinerary.geometry?.coordinates.length ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  // UF-403 : sans tracé par segment, la carte ne peut pas colorer par mode — la
  // géométrie d'ensemble ne dit pas où la marche s'arrête et où le métro commence.
  it('publishes a LineString on each segment, matching the itinerary geometry (UF-403)', () => {
    const { itineraries } = mergeIntoItineraries(sources(), PART_DIEU, BELLECOUR, prefs());

    for (const itinerary of itineraries) {
      const points: [number, number][] = [];

      for (const segment of itinerary.segments) {
        expect(segment.geometry?.type).toBe('LineString');
        expect(segment.geometry?.coordinates.length ?? 0).toBeGreaterThanOrEqual(2);

        for (const point of segment.geometry?.coordinates ?? []) {
          const last = points[points.length - 1];
          if (last && last[0] === point[0] && last[1] === point[1]) continue;
          points.push(point);
        }
      }

      // Les tracés de segments recollés doivent redonner exactement celui de
      // l'itinéraire : deux sources de vérité géométriques qui divergeraient
      // afficheraient un trait coloré à côté du trajet réel.
      expect(points).toEqual(itinerary.geometry?.coordinates);
    }
  });

  it('keeps totals equal to the sum of the segments', () => {
    const { itineraries } = mergeIntoItineraries(sources(), PART_DIEU, BELLECOUR, prefs());

    for (const itinerary of itineraries) {
      const sum = (key: 'durationMinutes' | 'distanceMeters' | 'carbonGrams') =>
        itinerary.segments.reduce((total, segment) => total + segment[key], 0);

      expect(itinerary.durationMinutes).toBe(sum('durationMinutes'));
      expect(itinerary.distanceMeters).toBe(sum('distanceMeters'));
      expect(itinerary.carbonGrams).toBe(sum('carbonGrams'));
    }
  });

  // -------------------------------------------------------------- recette 3

  it('drops the options that exceed the walking limit of the profile', () => {
    const patient = mergeIntoItineraries(sources(), PART_DIEU, BELLECOUR, prefs());
    const impatient = mergeIntoItineraries(
      sources(),
      PART_DIEU,
      BELLECOUR,
      prefs({ maxWalkMinutes: 10 }),
    );

    // Le tout-TC impose 15 minutes de marche d'accès : acceptable pour le
    // profil par défaut, hors limite pour celui qui plafonne à dix.
    expect(patient.itineraries.map((itinerary) => itinerary.id)).toContain('transit-1');
    expect(impatient.itineraries.map((itinerary) => itinerary.id)).not.toContain('transit-1');
    // Le rabattement à vélo, lui, survit : c'est justement ce qu'il corrige.
    expect(impatient.itineraries.map((itinerary) => itinerary.id)).toContain('bike-transit');
  });

  it('offers only wheelchair-friendly options to a reduced-mobility profile (C12)', () => {
    const { itineraries } = mergeIntoItineraries(
      sources(),
      PART_DIEU,
      BELLECOUR,
      prefs({ reducedMobility: true }),
    );

    expect(itineraries.length).toBeGreaterThan(0);
    expect(itineraries.every((itinerary) => itinerary.accessible)).toBe(true);
    // Un vélo en libre-service n'est pas une option en fauteuil roulant.
    expect(itineraries.some((itinerary) => itinerary.id.includes('bike'))).toBe(false);
  });

  it('orders by footprint for a green profile and by duration for a fast one', () => {
    const green = mergeIntoItineraries(sources(), PART_DIEU, BELLECOUR, prefs());
    const fast = mergeIntoItineraries(
      sources(),
      PART_DIEU,
      BELLECOUR,
      prefs({ priority: RoutePriority.FASTEST }),
    );

    expect(green.sortedBy).toBe('carbonAsc');
    expect(fast.sortedBy).toBe('durationAsc');

    const carbon = green.itineraries.map((itinerary) => itinerary.carbonGrams);
    expect(carbon).toEqual([...carbon].sort((a, b) => a - b));

    const durations = fast.itineraries.map((itinerary) => itinerary.durationMinutes);
    expect(durations).toEqual([...durations].sort((a, b) => a - b));

    // Deux profils, deux classements : la préférence est visible, pas théorique.
    // Ici le rabattement à vélo devance le tout-TC pour qui veut aller vite, et
    // l'inverse pour qui veut émettre le moins.
    const ids = (result: typeof green) => result.itineraries.map((itinerary) => itinerary.id);
    expect(ids(green)).not.toEqual(ids(fast));
    expect(ids(green)).toEqual(expect.arrayContaining(ids(fast)));
  });

  it('never lets a favourite mode empty the list, it only reorders the selection', () => {
    // Un profil « bus seulement » n'a aucune option bus ici. Le laisser sans
    // réponse serait pire que de lui proposer autre chose (C10).
    const { itineraries } = mergeIntoItineraries(
      sources(),
      PART_DIEU,
      BELLECOUR,
      prefs({ preferredModes: [TransportMode.WALK, TransportMode.BUS] }),
    );

    expect(itineraries.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------- recette 4

  it('caps the number of itineraries and keeps one option per family', () => {
    // Un trajet court, pour que les **quatre** familles soient constructibles,
    // et quatre variantes TC distinctes : six propositions au total, soit une
    // de plus que le plafond.
    const journeys = [
      shortJourney('transit-1', 'D'),
      shortJourney('transit-2', 'B'),
      shortJourney('transit-3', 'T1', TransportMode.TRAM),
      shortJourney('transit-4', 'C3', TransportMode.BUS),
    ];

    const { itineraries } = mergeIntoItineraries(
      sources({ journeys, destinationStations: [GUILLOTIERE_STATION] }),
      PART_DIEU,
      GUILLOTIERE,
      prefs({ maxWalkMinutes: 40 }),
    );

    expect(itineraries).toHaveLength(MAX_ITINERARIES);

    // Le plafond ne doit pas être rempli par une seule famille : sans la règle
    // de diversité, les quatre variantes de TC l'auraient saturé et masqué les
    // options douces — exactement la comparaison que le produit veut provoquer.
    const ids = itineraries.map((itinerary) => itinerary.id);
    expect(ids).toContain('bike');
    expect(ids).toContain('bike-transit');
    expect(ids).toContain('walk');
    expect(ids.filter((id) => id.startsWith('transit-')).length).toBeLessThanOrEqual(2);
  });

  // ------------------------------------------------ dégradation gracieuse (C10)

  it('still proposes transit when the shared-mobility operator is silent', () => {
    const { itineraries } = mergeIntoItineraries(
      sources({ sharedMobilityFailed: true }),
      PART_DIEU,
      BELLECOUR,
      prefs(),
    );

    expect(itineraries.map((itinerary) => itinerary.id)).toEqual(['transit-1']);
  });

  it('still proposes bikes when the transit engine is silent', () => {
    const { itineraries } = mergeIntoItineraries(
      sources({ transitFailed: true }),
      PART_DIEU,
      BELLECOUR,
      prefs(),
    );

    expect(itineraries.map((itinerary) => itinerary.id)).toEqual(['bike']);
  });

  it('returns nothing rather than inventing an itinerary when no chain can be formed', () => {
    // Le moteur a cherché et n'a rien trouvé, aucune borne ne loue, et la
    // distance est trop longue pour la marche seule.
    const { itineraries } = mergeIntoItineraries(
      sources({ journeys: [], originStations: [], destinationStations: [] }),
      PART_DIEU,
      BELLECOUR,
      prefs(),
    );

    expect(itineraries).toEqual([]);
  });

  // ------------------------------------------------------ règles de bon sens

  it('refuses a bike trip that cannot be ended at a docking station', () => {
    // La borne d'arrivée n'accepte plus les retours : le trajet ne finit pas.
    const full = station({ ...BELLECOUR_STATION, returning: false, docksAvailable: 0 });

    const { itineraries } = mergeIntoItineraries(
      sources({ destinationStations: [full] }),
      PART_DIEU,
      BELLECOUR,
      prefs(),
    );

    expect(itineraries.map((itinerary) => itinerary.id)).not.toContain('bike');
  });

  it('refuses a bike trip when no station has a bike left', () => {
    const empty = station({
      ...VILLETTE,
      vehiclesAvailable: 0,
      vehicles: [{ mode: TransportMode.BIKE, electric: false, count: 0 }],
    });

    const { itineraries } = mergeIntoItineraries(
      sources({ originStations: [empty] }),
      PART_DIEU,
      BELLECOUR,
      prefs(),
    );

    expect(itineraries.map((itinerary) => itinerary.id)).not.toContain('bike');
  });

  it('proposes walking alone on a short trip, and only then', () => {
    const short = mergeIntoItineraries(
      sources(),
      PART_DIEU,
      GUILLOTIERE,
      prefs({ maxWalkMinutes: 40 }),
    );
    const long = mergeIntoItineraries(
      sources(),
      PART_DIEU,
      BELLECOUR,
      prefs({ maxWalkMinutes: 40 }),
    );

    expect(short.itineraries.map((itinerary) => itinerary.id)).toContain('walk');
    // Part-Dieu → Bellecour fait plus de deux kilomètres et demi à pied : la
    // marche seule reste physiquement possible, mais ce n'est plus une option
    // qu'on propose.
    expect(long.itineraries.map((itinerary) => itinerary.id)).not.toContain('walk');
  });

  it('shortens the bike leg when the corridor is served by cycle facilities (UF-304)', () => {
    // Un aménagement qui suit exactement le corridor Villette → Gambetta.
    const along = cycleSegment('cp-1', sampleLine(VILLETTE, GAMBETTA, 40));

    const bare = mergeIntoItineraries(sources(), PART_DIEU, BELLECOUR, prefs());
    const equipped = mergeIntoItineraries(
      sources({ cycleSegments: [along] }),
      PART_DIEU,
      BELLECOUR,
      prefs(),
    );

    const bikeLeg = (result: ReturnType<typeof mergeIntoItineraries>) =>
      result.itineraries
        .find((itinerary) => itinerary.id === 'bike-transit')
        ?.segments.find((segment) => segment.mode === TransportMode.BIKE);

    const withoutFacility = bikeLeg(bare);
    const withFacility = bikeLeg(equipped);

    expect(withoutFacility).toBeDefined();
    expect(withFacility).toBeDefined();
    // Un corridor aménagé se parcourt plus directement : moins de détour, donc
    // moins de distance annoncée à qualité de service égale.
    expect(withFacility?.distanceMeters ?? 0).toBeLessThan(withoutFacility?.distanceMeters ?? 0);
  });

  // ------------------------------------------------------- horaires (UF-404)

  /**
   * Le panneau de résultats affiche « Départ 08:00 · Arrivée 08:23 » : sans ces
   * horaires, deux options de même durée sont indiscernables alors que l'une
   * part dans deux minutes et l'autre dans un quart d'heure.
   *
   * La règle vérifiée ici est celle qui compte : on **n'invente pas** d'heure.
   * Elle vient de la source quand elle existe, elle est ancrée dessus quand
   * l'itinéraire n'est daté qu'en partie, et elle est absente sinon.
   */
  const TIMED_JOURNEY = journey({
    legs: [
      leg({
        mode: TransportMode.WALK,
        from: place('Origin', PART_DIEU.lat, PART_DIEU.lng),
        to: place('Saxe-Gambetta', 45.7565, 4.848, 'TCL:1234'),
        durationMinutes: 15,
        distanceMeters: 1200,
        departureAt: '2026-08-26T08:00:00+02:00',
        arrivalAt: '2026-08-26T08:15:00+02:00',
      }),
      leg({
        mode: TransportMode.METRO,
        from: place('Saxe-Gambetta', 45.7565, 4.848, 'TCL:1234'),
        to: place('Bellecour', 45.7578, 4.8325, 'TCL:5678'),
        durationMinutes: 6,
        distanceMeters: 2000,
        line: 'B',
        departureAt: '2026-08-26T08:15:00+02:00',
        arrivalAt: '2026-08-26T08:21:00+02:00',
      }),
      leg({
        mode: TransportMode.WALK,
        from: place('Bellecour', 45.7578, 4.8325, 'TCL:5678'),
        to: place('Destination', BELLECOUR.lat, BELLECOUR.lng),
        durationMinutes: 2,
        distanceMeters: 100,
        departureAt: '2026-08-26T08:21:00+02:00',
        arrivalAt: '2026-08-26T08:23:00+02:00',
      }),
    ],
  });

  const findItinerary = (result: ReturnType<typeof mergeIntoItineraries>, id: string) =>
    result.itineraries.find((itinerary) => itinerary.id === id);

  /** Le résultat de la fusion sur la collecte nominale, trajet TC horodaté compris. */
  const timedResult = () =>
    mergeIntoItineraries(sources({ journeys: [TIMED_JOURNEY] }), PART_DIEU, BELLECOUR, prefs());

  it('publishes the GTFS schedule on transit segments and on the itinerary (UF-404)', () => {
    const transit = findItinerary(timedResult(), 'transit-1');
    expect(transit).toBeDefined();

    // Bornes du trajet, reprises telles que le moteur les a publiées.
    expect(Date.parse(transit?.departureAt ?? '')).toBe(Date.parse('2026-08-26T08:00:00+02:00'));
    expect(Date.parse(transit?.arrivalAt ?? '')).toBe(Date.parse('2026-08-26T08:23:00+02:00'));

    const metro = transit?.segments.find((segment) => segment.mode === TransportMode.METRO);
    expect(Date.parse(metro?.departureAt ?? '')).toBe(Date.parse('2026-08-26T08:15:00+02:00'));
    expect(Date.parse(metro?.arrivalAt ?? '')).toBe(Date.parse('2026-08-26T08:21:00+02:00'));
  });

  it('leaves an all-bike itinerary undated — it leaves whenever the rider does', () => {
    const bike = findItinerary(timedResult(), 'bike');
    expect(bike).toBeDefined();
    expect(bike?.departureAt).toBeUndefined();
    expect(bike?.arrivalAt).toBeUndefined();

    // Aucun de ses segments n'est daté non plus : une vitesse moyenne n'est pas
    // un horaire de réseau.
    expect(bike?.segments.every((segment) => segment.departureAt === undefined)).toBe(true);
  });

  it('anchors a partly dated itinerary on its transit legs (bike feeder — UF-404)', () => {
    const feeder = findItinerary(timedResult(), 'bike-transit');
    expect(feeder).toBeDefined();

    const segments = feeder?.segments ?? [];
    const firstDatedIndex = segments.findIndex((segment) => segment.departureAt !== undefined);

    // Le rabattement à vélo remplace la marche d'accès : il n'a pas d'horaire
    // propre, mais il précède un métro qui, lui, en a un.
    expect(firstDatedIndex).toBeGreaterThan(0);

    const leadMinutes = segments
      .slice(0, firstDatedIndex)
      .reduce((total, segment) => total + segment.durationMinutes, 0);
    const boarding = Date.parse(segments[firstDatedIndex]?.departureAt ?? '');

    // L'heure de départ est celle du métro moins la durée du rabattement — la
    // même arithmétique que la durée totale annoncée par ailleurs.
    expect(Date.parse(feeder?.departureAt ?? '')).toBe(boarding - leadMinutes * 60_000);
  });

  // --------------------------------------- UF-804 : sélecteur de modes et groupe

  describe('sélecteur de modes de l’écran (UF-804)', () => {
    /** Tous les modes cochés : c'est l'état initial du sélecteur, aucune exclusion. */
    const ALL_MODES = Object.values(TransportMode);

    it('n’exclut rien quand l’usager n’a rien décoché (`selectedModes` absent)', () => {
      const withoutSelector = mergeIntoItineraries(sources(), PART_DIEU, BELLECOUR, prefs());
      const withEverything = mergeIntoItineraries(
        sources(),
        PART_DIEU,
        BELLECOUR,
        prefs({ selectedModes: ALL_MODES }),
      );

      // Le champ absent et le champ complet doivent donner le même résultat :
      // sinon, ouvrir l'écran changerait la réponse sans que personne n'ait
      // touché à une case.
      expect(withoutSelector.itineraries.map((i) => i.summary)).toEqual(
        withEverything.itineraries.map((i) => i.summary),
      );
      expect(withoutSelector.itineraries.length).toBeGreaterThan(0);
    });

    it('écarte les itinéraires qui empruntent un mode décoché — filtre dur', () => {
      const result = mergeIntoItineraries(
        sources(),
        PART_DIEU,
        BELLECOUR,
        prefs({ selectedModes: [TransportMode.WALK, TransportMode.BIKE] }),
      );

      const modes = result.itineraries.flatMap((itinerary) =>
        itinerary.segments.map((segment) => segment.mode),
      );
      expect(modes).not.toContain(TransportMode.METRO);
      expect(modes.length).toBeGreaterThan(0);
    });

    it('garde la marche praticable même quand elle n’est pas cochée', () => {
      // Décocher « Marche » ne peut pas vouloir dire « ne pas marcher » : tout
      // itinéraire multimodal commence et finit à pied. Le seul candidat que
      // cela retire, c'est la marche **seule**.
      const result = mergeIntoItineraries(
        sources(),
        PART_DIEU,
        BELLECOUR,
        prefs({ selectedModes: [TransportMode.BIKE] }),
      );

      expect(result.itineraries.length).toBeGreaterThan(0);
      const hasWalkStep = result.itineraries.some((itinerary) =>
        itinerary.segments.some((segment) => segment.mode === TransportMode.WALK),
      );
      expect(hasWalkStep).toBe(true);
    });

    it('retire la marche seule quand « Marche » est décochée', () => {
      const shortTrip = sources({
        journeys: [shortJourney('transit-1', 'B')],
        destinationStations: [GUILLOTIERE_STATION],
      });

      const withWalk = mergeIntoItineraries(
        shortTrip,
        PART_DIEU,
        GUILLOTIERE,
        prefs({ maxWalkMinutes: 30, selectedModes: [TransportMode.WALK, TransportMode.METRO] }),
      );
      const withoutWalk = mergeIntoItineraries(
        shortTrip,
        PART_DIEU,
        GUILLOTIERE,
        prefs({ maxWalkMinutes: 30, selectedModes: [TransportMode.METRO] }),
      );

      const walkOnly = (result: ReturnType<typeof mergeIntoItineraries>) =>
        result.itineraries.filter((itinerary) =>
          itinerary.segments.every((segment) => segment.mode === TransportMode.WALK),
        );

      expect(walkOnly(withWalk)).toHaveLength(1);
      expect(walkOnly(withoutWalk)).toHaveLength(0);
    });

    it('rend une liste vide plutôt qu’une proposition non demandée', () => {
      // Un filtre dur peut tout retirer, et c'est le comportement attendu :
      // « rien ne correspond » se dit à l'écran (UF-405), il ne se contourne
      // pas en servant ce que l'usager vient d'exclure.
      const result = mergeIntoItineraries(
        sources({ originStations: [], destinationStations: [] }),
        PART_DIEU,
        BELLECOUR,
        prefs({ selectedModes: [TransportMode.TRAM] }),
      );

      expect(result.itineraries).toHaveLength(0);
    });
  });

  describe('taille du groupe (UF-804)', () => {
    /** Borne au départ qui n'a qu'un vélo — suffisante pour un, pas pour trois. */
    const ONE_BIKE = station({
      id: '1001',
      name: 'PART-DIEU / VILLETTE',
      lat: 45.7604,
      lng: 4.8598,
      vehiclesAvailable: 1,
      vehicles: [{ mode: TransportMode.BIKE, electric: false, count: 1 }],
    });

    const bikeFamilies = (travellers: number) =>
      mergeIntoItineraries(
        sources({ originStations: [ONE_BIKE], destinationStations: [BELLECOUR_STATION] }),
        PART_DIEU,
        BELLECOUR,
        prefs({ travellers }),
      ).itineraries.filter((itinerary) =>
        itinerary.segments.some((segment) => segment.mode === TransportMode.BIKE),
      );

    it('propose le vélo partagé au voyageur seul', () => {
      expect(bikeFamilies(1).length).toBeGreaterThan(0);
    });

    it('ne propose pas une borne qui n’a pas assez de vélos pour le groupe', () => {
      // Proposer un Vélo'v à trois depuis une borne qui n'en a qu'un est une
      // réponse fausse — et elle ne se découvre qu'une fois sur place (C10).
      expect(bikeFamilies(3)).toHaveLength(0);
    });

    it('exige aussi assez de places pour rendre les vélos', () => {
      const tightDropoff = station({
        id: '2001',
        name: 'BELLECOUR / RÉPUBLIQUE',
        lat: 45.758,
        lng: 4.8325,
        docksAvailable: 1,
      });

      const result = mergeIntoItineraries(
        sources({ originStations: [VILLETTE], destinationStations: [tightDropoff] }),
        PART_DIEU,
        BELLECOUR,
        prefs({ travellers: 3 }),
      );

      const bike = result.itineraries.filter((itinerary) =>
        itinerary.segments.some((segment) => segment.mode === TransportMode.BIKE),
      );
      expect(bike).toHaveLength(0);
    });
  });
});

/** Échantillonne une droite entre deux points, pour simuler un tracé cyclable. */
function sampleLine(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  steps: number,
): [number, number][] {
  const points: [number, number][] = [];
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    points.push([from.lng + (to.lng - from.lng) * ratio, from.lat + (to.lat - from.lat) * ratio]);
  }
  return points;
}
