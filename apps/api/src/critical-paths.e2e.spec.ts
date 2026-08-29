import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  CycleSegmentsResult,
  NearbyStationsResult,
  TransitJourney,
  TransitJourneysResult,
} from '@urbanflow/shared';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'net';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { requestIdMiddleware } from './common/logging/request-id.middleware';
import { TransportMode } from './common/enums/transport-mode.enum';
import { CyclePathsService } from './modules/transport/cycle-paths/cycle-paths.service';
import { SharedMobilityService } from './modules/transport/shared-mobility.service';
import { TransitService } from './modules/transport/transit.service';
import { PrismaService } from './prisma/prisma.service';

/**
 * Parcours critiques de bout en bout (UF-607, recette 3).
 *
 * ## Pourquoi ce test existe, alors que chaque service a déjà les siens
 *
 * Les tests unitaires du projet vérifient des pièces : le hachage argon2, la
 * fusion d'itinéraires, le barème carbone, le guard JWT. Aucun ne vérifie qu'on
 * peut **s'inscrire, se connecter, puis planifier un trajet** — c'est-à-dire le
 * seul enchaînement dont dépend la démonstration du produit. Or les régressions
 * qui coûtent le plus cher se logent précisément entre les pièces : un cookie
 * dont l'attribut change et que le navigateur ne renvoie plus, un
 * `ValidationPipe` qui se met à refuser un corps valide, un module oublié dans
 * `AppModule`. Un test qui monte l'application **entière** et parle HTTP est le
 * seul filet qui les attrape, et il tourne en CI à chaque push.
 *
 * ## Ce qui est réel, et ce qui est doublé
 *
 * Tout le chemin applicatif est réel : `AppModule` complet, pipes de validation,
 * guards JWT et de débit, filtre d'exceptions, sérialisation HTTP, cookies.
 * Deux frontières sont doublées, et deux seulement :
 *  - **la base** — un test de parcours ne doit pas exiger un PostGIS lancé pour
 *    tourner en CI, sinon il ne tourne pas, et un test qu'on n'exécute pas ne
 *    protège rien ;
 *  - **les trois sources externes** (OTP, GBFS, PostGIS géospatial) — leurs
 *    connecteurs ont leurs propres tests, et dépendre ici d'un opérateur tiers
 *    rendrait la CI rouge pour des raisons qui ne nous appartiennent pas.
 *
 * Les doublures restent fidèles aux contrats : le vélo en libre-service et les
 * pistes cyclables sont déclarés **indisponibles**, ce qui exerce au passage la
 * dégradation gracieuse (C10) — l'itinéraire tout-TC doit sortir quand même.
 */

/** Scénario nominal du projet (CLAUDE.md §1) : Part-Dieu → Bellecour. */
const PART_DIEU = { label: 'Gare Part-Dieu, Lyon', lat: 45.760515, lng: 4.859057 };
const BELLECOUR = { label: 'Place Bellecour, Lyon', lat: 45.757813, lng: 4.832011 };

const PASSWORD = 'Correct-Horse-Battery-42';

/** Trajet TC figé : marche → métro B → marche, le cas d'usage de référence. */
const TRANSIT_JOURNEY: TransitJourney = {
  id: 'transit-1',
  departureAt: '2026-08-26T08:00:00+02:00',
  arrivalAt: '2026-08-26T08:23:00+02:00',
  durationMinutes: 23,
  walkDistanceMeters: 900,
  transfers: 0,
  accessible: true,
  legs: [
    {
      mode: TransportMode.WALK,
      sourceMode: 'WALK',
      transit: false,
      from: { name: 'Départ', lat: PART_DIEU.lat, lng: PART_DIEU.lng },
      to: { name: 'Saxe-Gambetta', lat: 45.7565, lng: 4.848, stopId: 'TCL:1234' },
      departureAt: '2026-08-26T08:00:00+02:00',
      arrivalAt: '2026-08-26T08:10:00+02:00',
      durationMinutes: 10,
      distanceMeters: 800,
      accessible: true,
    },
    {
      mode: TransportMode.METRO,
      sourceMode: 'SUBWAY',
      transit: true,
      from: { name: 'Saxe-Gambetta', lat: 45.7565, lng: 4.848, stopId: 'TCL:1234' },
      to: { name: 'Bellecour', lat: 45.7578, lng: 4.8325, stopId: 'TCL:5678' },
      departureAt: '2026-08-26T08:10:00+02:00',
      arrivalAt: '2026-08-26T08:21:00+02:00',
      durationMinutes: 11,
      distanceMeters: 2000,
      line: 'B',
      accessible: true,
    },
    {
      mode: TransportMode.WALK,
      sourceMode: 'WALK',
      transit: false,
      from: { name: 'Bellecour', lat: 45.7578, lng: 4.8325, stopId: 'TCL:5678' },
      to: { name: 'Arrivée', lat: BELLECOUR.lat, lng: BELLECOUR.lng },
      departureAt: '2026-08-26T08:21:00+02:00',
      arrivalAt: '2026-08-26T08:23:00+02:00',
      durationMinutes: 2,
      distanceMeters: 100,
      accessible: true,
    },
  ],
};

/** Comptes créés pendant le test, indexés par e-mail — la « base » du test. */
interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
}

/**
 * Doublure de la base, réduite aux appels des parcours couverts.
 *
 * Elle imite le comportement qui compte pour ces parcours — l'unicité de
 * l'e-mail — et rien d'autre : le reste (contraintes PostGIS, transactions) est
 * couvert par les tests des services concernés.
 */
function createPrismaDouble(): {
  prisma: Record<string, unknown>;
  users: Map<string, StoredUser>;
} {
  const users = new Map<string, StoredUser>();
  let nextId = 1;

  const prisma = {
    user: {
      create: ({ data }: { data: { email: string; passwordHash: string } }) => {
        if (users.has(data.email)) {
          // Le service ne rattrape que `PrismaClientKnownRequestError` P2002 ;
          // ce test ne vise pas ce cas, il vérifie seulement qu'un doublon ne
          // crée pas un second compte silencieusement.
          return Promise.reject(new Error('unique constraint'));
        }
        const user: StoredUser = {
          id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
          email: data.email,
          passwordHash: data.passwordHash,
        };
        users.set(user.email, user);
        return Promise.resolve({ id: user.id, email: user.email });
      },
      findUnique: ({ where }: { where: { email?: string; id?: string } }) => {
        const found =
          where.email !== undefined
            ? users.get(where.email)
            : [...users.values()].find((user) => user.id === where.id);
        return Promise.resolve(found ?? null);
      },
    },
    mobilityProfile: {
      // Aucun profil enregistré : le planificateur applique les préférences par
      // défaut, ce qui est bien l'état d'un compte fraîchement créé.
      findUnique: () => Promise.resolve(null),
    },
    // Insertion de l'historique de recherche (SQL brut, géométries PostGIS).
    $queryRaw: () =>
      Promise.resolve([
        {
          id: '99999999-9999-4999-8999-999999999999',
          fromLabel: PART_DIEU.label,
          fromLat: PART_DIEU.lat,
          fromLng: PART_DIEU.lng,
          toLabel: BELLECOUR.label,
          toLat: BELLECOUR.lat,
          toLng: BELLECOUR.lng,
          selectedSummary: null,
          carbonGrams: null,
          carEquivalentGrams: null,
          createdAt: new Date('2026-08-26T08:00:00.000Z'),
        },
      ]),
  };

  return { prisma, users };
}

describe('Parcours critiques (auth + plan) — UF-607', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    // Configuration minimale et factice : `validateEnv` refuse de démarrer si
    // une variable manque (fail-fast C4), et c'est très bien — le test doit
    // partir d'une application correctement configurée, pas d'une exception.
    Object.assign(process.env, {
      PORT: '3001',
      CORS_ORIGIN: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/urbanflow?schema=public',
      JWT_SECRET: 'test-secret-uf607-critical-paths-at-least-32-chars',
      JWT_EXPIRES_IN: '15m',
      OTP_BASE_URL: 'http://localhost:8080',
      OTP_TIMEOUT_MS: '12000',
      GBFS_DISCOVERY_URL: 'http://localhost:9999/gbfs.json',
      GBFS_TIMEOUT_MS: '5000',
      GBFS_STATUS_TTL_MS: '60000',
    });

    const transitDouble = {
      getTransitJourneys: (): Promise<TransitJourneysResult> =>
        Promise.resolve({
          status: 'ok',
          journeys: [TRANSIT_JOURNEY],
          requestedDate: '2026-08-26',
          serviceDate: '2026-08-26',
          dateAdjusted: false,
        }),
    };
    const sharedMobilityDouble = {
      getNearbyStations: (): Promise<NearbyStationsResult> =>
        Promise.resolve({
          status: 'unavailable',
          stations: [],
          unavailableReason: 'network',
          radiusMeters: 900,
          publishedAt: null,
        }),
    };
    const cyclePathsDouble = {
      getCycleSegments: (): Promise<CycleSegmentsResult> =>
        Promise.reject(new Error('PostGIS unavailable in tests')),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createPrismaDouble().prisma)
      .overrideProvider(TransitService)
      .useValue(transitDouble)
      .overrideProvider(SharedMobilityService)
      .useValue(sharedMobilityDouble)
      .overrideProvider(CyclePathsService)
      .useValue(cyclePathsDouble)
      .compile();

    app = moduleRef.createNestApplication();
    // Même chaîne que `main.ts` : sans elle, le test validerait une application
    // qui n'existe nulle part (cookies non lus, corps non validés).
    app.setGlobalPrefix('api');
    app.use(requestIdMiddleware);
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();
    await app.listen(0); // port éphémère
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/api`;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Extrait le cookie de session d'une réponse d'authentification. */
  function sessionCookie(response: Response): string {
    const setCookie = response.headers.get('set-cookie') ?? '';
    const [pair] = setCookie.split(';');
    return pair;
  }

  it('parcours F1 : inscription, connexion, session — et refus des identifiants faux', async () => {
    const email = `marie.${Date.now()}@example.com`;

    const registered = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(registered.status).toBe(201);
    // Le jeton part en cookie httpOnly, jamais exploitable par le JS (C11).
    expect(registered.headers.get('set-cookie')).toContain('HttpOnly');

    const loggedIn = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(loggedIn.status).toBe(200);

    const session = await fetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: sessionCookie(loggedIn) },
    });
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({ email });

    const wrongPassword = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'not-the-password' }),
    });
    expect(wrongPassword.status).toBe(401);
  });

  it('parcours F2 : un compte connecté obtient des itinéraires valorisés en CO₂', async () => {
    const email = `plan.${Date.now()}@example.com`;
    const registered = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const cookie = sessionCookie(registered);

    const response = await fetch(`${baseUrl}/routes/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ from: PART_DIEU, to: BELLECOUR }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      itineraries: { carbonGrams: number; segments: unknown[] }[];
      sources: { source: string; available: boolean }[];
      searchHistoryId?: string;
    };

    // Au moins une option, valorisée en carbone : c'est la proposition de
    // valeur du produit, pas un détail d'affichage.
    expect(body.itineraries.length).toBeGreaterThan(0);
    expect(body.itineraries[0].carbonGrams).toBeGreaterThanOrEqual(0);
    expect(body.itineraries[0].segments.length).toBeGreaterThan(0);

    // Dégradation gracieuse (C10) : deux sources muettes n'empêchent pas la
    // réponse, et l'état de chacune est publié pour que le front puisse le dire.
    const availability = Object.fromEntries(
      body.sources.map((source) => [source.source, source.available]),
    );
    expect(availability).toMatchObject({ transit: true, sharedMobility: false });

    // La recherche est enregistrée (étape 18 du flux) et sa ligne est rendue.
    expect(body.searchHistoryId).toBeDefined();
  });

  it('parcours F2 : sans session, la planification est refusée (401) — étape 2 du flux', async () => {
    const response = await fetch(`${baseUrl}/routes/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: PART_DIEU, to: BELLECOUR }),
    });

    expect(response.status).toBe(401);
  });

  it('refuse un userId dans le corps de la requête (anti-usurpation, UF-402)', async () => {
    const email = `idor.${Date.now()}@example.com`;
    const registered = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });

    const response = await fetch(`${baseUrl}/routes/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie(registered) },
      body: JSON.stringify({
        from: PART_DIEU,
        to: BELLECOUR,
        userId: '00000000-0000-4000-8000-000000000001',
      }),
    });

    expect(response.status).toBe(400);
  });

  it('joint un identifiant de corrélation à chaque réponse, erreurs comprises (UF-607)', async () => {
    const response = await fetch(`${baseUrl}/routes/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: PART_DIEU, to: BELLECOUR }),
    });
    const body = (await response.json()) as { requestId?: string };

    // Le même identifiant dans l'en-tête et dans le corps : c'est ce que
    // l'usager recopie dans un signalement de bogue, et ce que l'on cherche
    // ensuite dans les journaux (docs/bug-process.md).
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
  });

  it("journalise une erreur remontée par l'interface sans exiger de session (UF-607)", async () => {
    const response = await fetch(`${baseUrl}/diagnostics/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: "Cannot read properties of undefined (reading 'segments')",
        name: 'TypeError',
        screen: 'planner',
      }),
    });

    expect(response.status).toBe(204);
  });

  it("refuse un signalement dont l'écran n'est pas connu (entrée non validée)", async () => {
    const response = await fetch(`${baseUrl}/diagnostics/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'boom', screen: '../../etc/passwd' }),
    });

    expect(response.status).toBe(400);
  });
});
