import {
  CycleFacilityType,
  TransportMode as SharedTransportMode,
  type CycleSegment,
  type Itinerary,
  type LineStringGeometry,
  type RouteSegment,
  type SharedMobilityStation,
  type TransitJourney,
  type TransitLeg,
} from '@urbanflow/shared';

import { RoutePriority } from '../../common/enums/route-priority.enum';
import { TransportMode } from '../../common/enums/transport-mode.enum';
import { toNearbyStations } from '../transport/gbfs/gbfs.mapper';
import type { CollectedSources } from './sources/collected-sources';
import {
  mergeIntoItineraries,
  type MergeEndpoint,
  type MergePreferences,
} from './merge/itinerary-merger';

/**
 * Recette d'**interopérabilité** du ticket UF-606 (C9).
 *
 * ## Ce que ce fichier prouve, et pourquoi il existe
 *
 * « Nous utilisons des formats standards » est, dans un dossier, une phrase
 * gratuite : GTFS, GBFS et GeoJSON sont des noms qu'on peut écrire sans les
 * respecter. Les autres tests du module vérifient que la **fusion** est juste —
 * chaînes continues, plafond, préférences honorées. Aucun ne vérifiait que ce
 * qui sort du serveur est conforme aux spécifications qu'il revendique.
 *
 * C'est ce trou que ce fichier ferme. Il exerce le vrai `mergeIntoItineraries`
 * sur le scénario nominal du projet (Part-Dieu → Bellecour) et le vrai mapper
 * GBFS sur une charge utile conforme au format, puis confronte le résultat aux
 * règles écrites des normes :
 *
 * | Norme                              | Ce qui est vérifié ici                        |
 * | ---------------------------------- | --------------------------------------------- |
 * | **RFC 7946** (GeoJSON)             | tout `geometry` publié est une `LineString` valide : type exact, ≥ 2 positions, ordre `[longitude, latitude]`, bornes respectées |
 * | **ISO 8601** (dates)               | tout horodatage publié porte un fuseau et se relit sans ambiguïté |
 * | **GBFS v2** (`station_information` + `station_status`) | les champs normalisés de l'opérateur arrivent intacts dans le contrat interne |
 * | **GTFS** (via OTP)                 | le vocabulaire de modes publié est celui du contrat partagé, pas celui de la source |
 *
 * ## Pourquoi les valider ici, et pas au bord du réseau
 *
 * Un contrôle posé sur la réponse HTTP exigerait OTP, un flux GBFS vivant et
 * PostGIS : il ne tournerait ni en CI ni pendant la démonstration, et c'est
 * précisément la sorte de test qu'on finit par ignorer. La fusion étant une
 * fonction pure, ces règles se vérifient sur des données figées, en quelques
 * millisecondes, à chaque `npm test`.
 *
 * La contrepartie est explicite : ce fichier valide **ce que le serveur
 * publie**, pas ce que l'opérateur envoie. La lecture des flux distants reste
 * couverte par `gbfs.client.spec.ts` et `otp.client.spec.ts`.
 */
describe('interopérabilité des formats publiés (C9)', () => {
  // --------------------------------------------------------------- normes

  /*
   * Les contrôles rendent une **liste d'écarts** au lieu d'assener des `expect`.
   *
   * Jest, contrairement à Vitest, n'accepte pas de message sur une assertion :
   * un `expect(x).toBe(2)` rouge au milieu d'une boucle sur quatre itinéraires
   * dit « attendu 2, reçu 1 » et rien de plus — ni lequel, ni quel segment.
   * En collectant les écarts puis en exigeant un tableau vide, le rapport
   * d'échec nomme lui-même le fautif :
   *
   *     Expected: []
   *     Received: ["bike-transit segment 2 (BIKE) : 1 position (RFC 7946 en exige 2)"]
   */

  /**
   * Écarts d'une géométrie à la RFC 7946, §3.1.4 (« LineString »).
   *
   * Trois règles y sont normatives et toutes les trois sont vérifiées, parce
   * que chacune se viole silencieusement :
   *
   * 1. **`type` exactement `"LineString"`** — la casse compte ; un
   *    `"linestring"` passerait tous les `typeof` du monde et serait refusé par
   *    n'importe quel consommateur tiers.
   * 2. **Au moins deux positions** — une « ligne » d'un seul point est invalide.
   *    C'est le piège le plus facile à créer : un segment dont la source n'a
   *    renvoyé qu'un point produit naturellement un tableau de un.
   * 3. **Position en `[longitude, latitude]`** — l'inversion est l'erreur
   *    classique du géospatial, et elle est indétectable à l'œil sur Lyon
   *    (45.76, 4.85) : les deux nombres sont plausibles. Les bornes de la RFC
   *    (±180 / ±90) l'attrapent dès que la latitude dépasse 90, mais pas sur
   *    Lyon — d'où le contrôle d'enveloppe géographique plus bas.
   *
   * @param geometry La géométrie publiée
   * @param context Ce qui l'a produite, repris tel quel dans le rapport d'échec
   * @returns Un écart par règle violée ; tableau vide si la géométrie est conforme
   */
  const lineStringViolations = (geometry: LineStringGeometry, context: string): string[] => {
    const violations: string[] = [];

    if (geometry.type !== 'LineString') {
      violations.push(`${context} : type « ${geometry.type} » au lieu de « LineString »`);
    }
    if (!Array.isArray(geometry.coordinates)) {
      violations.push(`${context} : coordinates n'est pas un tableau`);
      return violations;
    }
    if (geometry.coordinates.length < 2) {
      violations.push(
        `${context} : ${geometry.coordinates.length} position(s) — la RFC 7946 §3.1.4 en exige 2`,
      );
    }

    for (const [index, position] of geometry.coordinates.entries()) {
      const where = `${context} position ${index}`;
      if (position.length !== 2) {
        violations.push(
          `${where} : ${position.length} composante(s), attendu [longitude, latitude]`,
        );
        continue;
      }

      const [longitude, latitude] = position;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        violations.push(`${where} : coordonnée non finie (${longitude}, ${latitude})`);
        continue;
      }
      if (longitude < -180 || longitude > 180) {
        violations.push(`${where} : longitude ${longitude} hors [-180, 180]`);
      }
      if (latitude < -90 || latitude > 90) {
        violations.push(`${where} : latitude ${latitude} hors [-90, 90]`);
      }
    }

    return violations;
  };

  /**
   * Enveloppe très large autour de la métropole de Lyon.
   *
   * Elle n'est pas là pour juger la précision du tracé, mais pour attraper une
   * **inversion** `[lat, lng]` : intervertis, les points de Lyon tombent vers
   * (4.85, 45.76), c'est-à-dire au large du golfe de Guinée. Les bornes de la
   * RFC ne le voient pas — 45.76 est une longitude parfaitement légale.
   */
  const LYON_BBOX = { minLng: 4.5, maxLng: 5.2, minLat: 45.5, maxLat: 46.0 };

  const outsideLyon = (geometry: LineStringGeometry, context: string): string[] =>
    geometry.coordinates
      .filter(
        ([longitude, latitude]) =>
          longitude <= LYON_BBOX.minLng ||
          longitude >= LYON_BBOX.maxLng ||
          latitude <= LYON_BBOX.minLat ||
          latitude >= LYON_BBOX.maxLat,
      )
      .map(
        ([longitude, latitude]) =>
          `${context} : (${longitude}, ${latitude}) hors métropole — axes inversés ?`,
      );

  /**
   * Écarts d'un horodatage à ISO 8601, fuseau **compris**.
   *
   * `Date.parse` ne suffit pas : il accepte volontiers `2026-08-26T08:00:00`,
   * dont l'instant dépend du fuseau du lecteur. Un horaire de bus interprété
   * dans le mauvais fuseau se décale de deux heures en été — le genre de bogue
   * qui ne se voit qu'en production. La norme est donc vérifiée sur la forme,
   * puis sur la relecture.
   */
  const ISO_8601_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

  const iso8601Violations = (value: string, context: string): string[] => {
    if (!ISO_8601_WITH_OFFSET.test(value)) {
      return [`${context} : « ${value} » n'est pas de l'ISO 8601 avec fuseau`];
    }
    if (Number.isNaN(Date.parse(value))) {
      return [`${context} : « ${value} » ne se relit pas comme un instant`];
    }
    return [];
  };

  // ----------------------------------------------------------- jeu figé

  const PART_DIEU: MergeEndpoint = { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 };
  const BELLECOUR: MergeEndpoint = { label: 'Bellecour', lat: 45.757813, lng: 4.832011 };

  const PREFS: MergePreferences = {
    preferredModes: [
      TransportMode.WALK,
      TransportMode.METRO,
      TransportMode.BIKE,
      TransportMode.BUS,
    ],
    priority: RoutePriority.GREENEST,
    reducedMobility: false,
    maxWalkMinutes: 20,
    travellers: 1,
  };

  const place = (name: string, lat: number, lng: number, stopId?: string) => ({
    name,
    lat,
    lng,
    ...(stopId ? { stopId } : {}),
  });

  /** Tracé plausible entre deux points : deux positions suffisent à une LineString. */
  const line = (from: [number, number], to: [number, number]): LineStringGeometry => ({
    type: 'LineString',
    coordinates: [from, to],
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
   * Trajet TC tel qu'OpenTripPlanner le renvoie sur le jeu GTFS TCL : marche
   * d'accès longue, métro, marche de sortie, chaque tronçon horodaté et tracé.
   */
  const JOURNEY: TransitJourney = {
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
        departureAt: '2026-08-26T08:00:00+02:00',
        arrivalAt: '2026-08-26T08:15:00+02:00',
        geometry: line([4.859057, 45.760515], [4.848, 45.7565]),
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
        geometry: line([4.848, 45.7565], [4.8325, 45.7578]),
      }),
      leg({
        mode: TransportMode.WALK,
        from: place('Bellecour', 45.7578, 4.8325, 'TCL:5678'),
        to: place('Destination', BELLECOUR.lat, BELLECOUR.lng),
        durationMinutes: 2,
        distanceMeters: 100,
        departureAt: '2026-08-26T08:21:00+02:00',
        arrivalAt: '2026-08-26T08:23:00+02:00',
        geometry: line([4.8325, 45.7578], [4.832011, 45.757813]),
      }),
    ],
  };

  const station = (
    overrides: Partial<SharedMobilityStation> &
      Pick<SharedMobilityStation, 'id' | 'name' | 'lat' | 'lng'>,
  ): SharedMobilityStation => ({
    distanceMeters: 0,
    capacity: 20,
    vehiclesAvailable: 8,
    vehicles: [{ mode: SharedTransportMode.BIKE, electric: false, count: 8 }],
    docksAvailable: 12,
    renting: true,
    returning: true,
    lastReportedAt: '2026-08-26T07:59:00+02:00',
    ...overrides,
  });

  const CYCLE_SEGMENT: CycleSegment = {
    id: 'voie-1',
    name: 'Rue Garibaldi',
    facilityType: CycleFacilityType.CYCLE_TRACK,
    sourceFacilityType: 'Piste Cyclable',
    network: 'Voies Lyonnaises',
    surface: 'Enrobé',
    distanceMeters: 10,
    lengthMeters: 800,
    geometry: {
      type: 'MultiLineString',
      coordinates: [
        [
          [4.8598, 45.7604],
          [4.8483, 45.7567],
        ],
      ],
    },
  };

  const SOURCES: CollectedSources = {
    transit: {
      status: 'ok',
      elapsedMs: 120,
      data: {
        status: 'ok',
        journeys: [JOURNEY],
        requestedDate: '2026-08-26',
        serviceDate: '2022-09-01',
        dateAdjusted: true,
      },
    },
    sharedMobility: {
      status: 'ok',
      elapsedMs: 60,
      data: {
        origin: {
          status: 'ok',
          stations: [
            station({ id: '1001', name: 'PART-DIEU / VILLETTE', lat: 45.7604, lng: 4.8598 }),
            station({ id: '1002', name: 'SAXE / GAMBETTA', lat: 45.7567, lng: 4.8483 }),
          ],
          radiusMeters: 900,
          publishedAt: '2026-08-26T07:59:00+02:00',
        },
        destination: {
          status: 'ok',
          stations: [
            station({ id: '2001', name: 'BELLECOUR / RÉPUBLIQUE', lat: 45.758, lng: 4.8325 }),
          ],
          radiusMeters: 900,
          publishedAt: '2026-08-26T07:59:00+02:00',
        },
      },
    },
    cyclePaths: {
      status: 'ok',
      elapsedMs: 8,
      data: {
        origin: { segments: [CYCLE_SEGMENT], radiusMeters: 300, datasetImportedAt: null },
        destination: { segments: [], radiusMeters: 300, datasetImportedAt: null },
      },
    },
    failures: [],
    allSourcesFailed: false,
    elapsedMs: 130,
  } as CollectedSources;

  /*
    La fusion est jouée une fois pour tout le fichier, dans un `beforeAll` :
    elle est pure et coûteuse à relire, et une exception à l'import ferait
    échouer la *suite* — un message autrement moins lisible qu'un test rouge.
  */
  let itineraries: Itinerary[];
  /** Tous les segments de tous les itinéraires, aplatis — le corpus à valider. */
  let allSegments: { itinerary: Itinerary; segment: RouteSegment; index: number }[];

  beforeAll(() => {
    itineraries = mergeIntoItineraries(SOURCES, PART_DIEU, BELLECOUR, PREFS).itineraries;
    allSegments = itineraries.flatMap((itinerary) =>
      itinerary.segments.map((segment, index) => ({ itinerary, segment, index })),
    );
  });

  it('produit un corpus non vide — sans quoi les contrôles suivants ne prouveraient rien', () => {
    // Un test de conformité qui itère sur un tableau vide passe toujours. Ce
    // garde-fou est la condition de validité de tout le reste du fichier.
    expect(itineraries.length).toBeGreaterThan(0);
    expect(allSegments.length).toBeGreaterThan(0);
    expect(allSegments.some(({ segment }) => segment.geometry)).toBe(true);
  });

  // --------------------------------------------------------- RFC 7946

  describe('GeoJSON — RFC 7946', () => {
    it("publie des LineString valides pour chaque tracé d'itinéraire", () => {
      const violations = itineraries.flatMap((itinerary, index) =>
        // Absence assumée par le contrat : `geometry?` peut manquer, jamais être
        // une ligne dégénérée. C'est le test suivant qui tient cette promesse.
        itinerary.geometry
          ? [
              ...lineStringViolations(itinerary.geometry, `itinéraire ${index} (${itinerary.id})`),
              ...outsideLyon(itinerary.geometry, `itinéraire ${index} (${itinerary.id})`),
            ]
          : [],
      );

      expect(violations).toEqual([]);
    });

    it('publie des LineString valides pour chaque segment tracé', () => {
      const violations = allSegments.flatMap(({ itinerary, segment, index }) => {
        if (!segment.geometry) return [];
        const context = `${itinerary.id} segment ${index} (${segment.mode})`;
        return [
          ...lineStringViolations(segment.geometry, context),
          ...outsideLyon(segment.geometry, context),
        ];
      });

      expect(violations).toEqual([]);
    });

    it('ne publie jamais une géométrie dégénérée plutôt que de l’omettre', () => {
      // Le contrat documente une absence possible (`geometry?`). Ce qu'il
      // interdit, c'est une géométrie **présente et invalide** : un client tiers
      // sait ignorer un champ absent, pas rattraper une LineString d'un point.
      const degenerate = [
        ...itineraries.map((itinerary) => ({ what: itinerary.id, geometry: itinerary.geometry })),
        ...allSegments.map(({ itinerary, segment, index }) => ({
          what: `${itinerary.id} segment ${index}`,
          geometry: segment.geometry,
        })),
      ]
        .filter(({ geometry }) => geometry !== undefined && geometry.coordinates.length < 2)
        .map(({ what }) => what);

      expect(degenerate).toEqual([]);
    });
  });

  // ---------------------------------------------------------- ISO 8601

  describe('Horodatages — ISO 8601', () => {
    it('porte un fuseau sur chaque horaire publié', () => {
      const violations = [
        ...itineraries.flatMap((itinerary) => [
          ...(itinerary.departureAt
            ? iso8601Violations(itinerary.departureAt, `${itinerary.id} départ`)
            : []),
          ...(itinerary.arrivalAt
            ? iso8601Violations(itinerary.arrivalAt, `${itinerary.id} arrivée`)
            : []),
        ]),
        ...allSegments.flatMap(({ itinerary, segment, index }) => {
          const context = `${itinerary.id} segment ${index}`;
          return [
            ...(segment.departureAt
              ? iso8601Violations(segment.departureAt, `${context} départ`)
              : []),
            ...(segment.arrivalAt
              ? iso8601Violations(segment.arrivalAt, `${context} arrivée`)
              : []),
          ];
        }),
      ];

      expect(violations).toEqual([]);
    });

    it('ordonne départ avant arrivée sur chaque fenêtre horodatée', () => {
      // Une paire ISO valide mais inversée est conforme à la norme et fausse
      // dans le produit : le client afficherait « Départ 10:03 · Arrivée 09:47 ».
      const inverted = itineraries
        .filter(
          (itinerary) =>
            itinerary.departureAt !== undefined &&
            itinerary.arrivalAt !== undefined &&
            Date.parse(itinerary.arrivalAt) < Date.parse(itinerary.departureAt),
        )
        .map((itinerary) => `${itinerary.id} : ${itinerary.departureAt} → ${itinerary.arrivalAt}`);

      expect(inverted).toEqual([]);
    });
  });

  // -------------------------------------------------------------- GTFS

  describe('GTFS via OpenTripPlanner — vocabulaire publié', () => {
    it('ne publie que des modes du contrat partagé', () => {
      // Le client type ses affichages sur cette énumération : une valeur
      // inconnue — un `RAIL` d'OTP laissé tel quel, par exemple — casserait la
      // carte et les badges sans que rien ne le signale côté serveur.
      const vocabulary = new Set<string>(Object.values(SharedTransportMode));
      const unknown = allSegments
        .filter(({ segment }) => !vocabulary.has(segment.mode))
        .map(
          ({ itinerary, segment, index }) =>
            `${itinerary.id} segment ${index} : mode « ${segment.mode} » hors vocabulaire publié`,
        );

      expect(unknown).toEqual([]);
    });

    it('publie des grandeurs physiques exploitables par un tiers', () => {
      // Durées en minutes, distances en mètres, CO₂ en grammes : les unités du
      // contrat. Un négatif ou un NaN traverserait JSON sans bruit.
      const nonsense = allSegments.flatMap(({ itinerary, segment, index }) => {
        const context = `${itinerary.id} segment ${index}`;
        const quantities: [string, number][] = [
          ['durationMinutes', segment.durationMinutes],
          ['distanceMeters', segment.distanceMeters],
          ['carbonGrams', segment.carbonGrams],
        ];

        return quantities
          .filter(([, value]) => !Number.isFinite(value) || value < 0)
          .map(([name, value]) => `${context} : ${name} = ${value}`);
      });

      expect(nonsense).toEqual([]);
    });
  });

  // -------------------------------------------------------------- GBFS

  describe('GBFS v2 — mapping des flux opérateur', () => {
    /**
     * Charges utiles conformes à GBFS v2.3, avec les noms de champs de la
     * **spécification** et non les nôtres : `station_information` porte
     * l'identité et la capacité, `station_status` la disponibilité temps réel,
     * `vehicle_types` le facteur de forme et la motorisation.
     *
     * C'est tout l'intérêt du contrôle : si un jour le mapper se met à lire
     * `longitude` au lieu de `lon`, ou à traiter `last_reported` comme des
     * millisecondes, ces trois objets le disent immédiatement.
     */
    const information = [
      {
        station_id: '1001',
        name: 'PART-DIEU / VILLETTE',
        lat: 45.7604,
        lon: 4.8598,
        address: '10 rue de la Villette',
        capacity: 20,
      },
    ];

    const LAST_REPORTED_EPOCH = 1_756_195_140; // secondes epoch — l'unité GBFS

    const status = [
      {
        station_id: '1001',
        num_bikes_available: 8,
        num_docks_available: 12,
        is_installed: true,
        is_renting: true,
        is_returning: true,
        last_reported: LAST_REPORTED_EPOCH,
        vehicle_types_available: [
          { vehicle_type_id: 'bike', count: 5 },
          { vehicle_type_id: 'ebike', count: 3 },
        ],
      },
    ];

    const vehicleTypes = [
      { vehicle_type_id: 'bike', form_factor: 'bicycle', propulsion_type: 'human' },
      { vehicle_type_id: 'ebike', form_factor: 'bicycle', propulsion_type: 'electric_assist' },
    ];

    const mapped = () =>
      toNearbyStations({
        information,
        status,
        vehicleTypes,
        origin: { lat: 45.7604, lng: 4.8598 },
        radiusMeters: 900,
        limit: 10,
      });

    it('transporte les champs normalisés de GBFS jusqu’au contrat interne', () => {
      const [station] = mapped();

      expect(station).toBeDefined();
      expect(station.id).toBe('1001');
      expect(station.name).toBe('PART-DIEU / VILLETTE');
      expect(station.address).toBe('10 rue de la Villette');
      expect(station.capacity).toBe(20);
      expect(station.vehiclesAvailable).toBe(8);
      expect(station.docksAvailable).toBe(12);
      expect(station.renting).toBe(true);
      expect(station.returning).toBe(true);
    });

    it('renomme `lon` en `lng` sans intervertir les axes', () => {
      // Le seul endroit, côté vélos, où une inversion géographique peut naître :
      // GBFS dit `lat`/`lon`, le contrat interne dit `lat`/`lng`. Intervertis,
      // les Vélo'v lyonnais se retrouveraient au large du golfe de Guinée.
      const [station] = mapped();

      expect(station.lat).toBeCloseTo(45.7604, 4);
      expect(station.lng).toBeCloseTo(4.8598, 4);
      expect(station.lng).toBeGreaterThan(LYON_BBOX.minLng);
      expect(station.lng).toBeLessThan(LYON_BBOX.maxLng);
      expect(station.lat).toBeGreaterThan(LYON_BBOX.minLat);
      expect(station.lat).toBeLessThan(LYON_BBOX.maxLat);
    });

    it('convertit `last_reported` (secondes epoch GBFS) en ISO 8601 daté', () => {
      // GBFS publie des secondes, JavaScript compte en millisecondes. Confondre
      // les deux décale la fraîcheur d'une station de plusieurs décennies, et
      // rien dans le type ne l'empêche : les deux sont des `number`.
      const [station] = mapped();

      expect(station.lastReportedAt).toBeDefined();
      expect(
        iso8601Violations(station.lastReportedAt as string, 'station 1001 lastReportedAt'),
      ).toEqual([]);
      expect(Date.parse(station.lastReportedAt as string)).toBe(LAST_REPORTED_EPOCH * 1000);
    });

    it('traduit le vocabulaire `form_factor`/`propulsion_type` en modes publiés', () => {
      // GBFS décrit une flotte par facteur de forme et motorisation ; le produit
      // raisonne en modes de transport. La traduction est ce qui permet au
      // Service Carbone de distinguer un vélo musculaire d'un vélo à assistance,
      // qui n'ont pas le même facteur d'émission.
      const [station] = mapped();
      const vocabulary = new Set<string>(Object.values(SharedTransportMode));

      expect(station.vehicles.length).toBeGreaterThan(0);
      for (const availability of station.vehicles) {
        expect(vocabulary.has(availability.mode)).toBe(true);
        expect(availability.count).toBeGreaterThan(0);
      }
      expect(station.vehicles.some((v) => v.electric)).toBe(true);
      expect(station.vehicles.some((v) => !v.electric)).toBe(true);
    });
  });
});
