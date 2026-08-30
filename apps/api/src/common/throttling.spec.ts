import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AuthController } from '../modules/auth/auth.controller';
import { AuthService } from '../modules/auth/auth.service';
import { RoutesController } from '../modules/routes/routes.controller';
import { RoutesService } from '../modules/routes/routes.service';
import { IpThrottlerGuard } from './guards/ip-throttler.guard';
import {
  AUTH_THROTTLE_LIMIT,
  GLOBAL_THROTTLE,
  PLAN_THROTTLE_LIMIT,
  THROTTLER_OPTIONS,
} from './throttling';

/**
 * Recette 2 d'UF-604 : « le login est protégé contre le brute-force
 * (rate limiting effectif) ».
 *
 * Le test monte les **vrais contrôleurs**, avec leurs vrais décorateurs, et
 * martèle l'endpoint par HTTP. C'est délibéré : vérifier une valeur de
 * constante prouverait seulement qu'on sait écrire `5`, pas que la 6ᵉ requête
 * est effectivement refusée. Seuls les services métier sont doublés — ils ne
 * sont pas le sujet, et la démonstration doit tenir sans base de données.
 *
 * Le guard compte par IP : toutes les requêtes de supertest viennent de
 * `127.0.0.1`, elles partagent donc un compteur, exactement comme une rafale
 * lancée depuis une seule machine.
 */
describe('Rate limiting (UF-604 — C4 / OWASP A07)', () => {
  let app: INestApplication;

  /** Double d'`AuthService` : des identifiants toujours valides, pour que seul le plafond puisse refuser. */
  const authService = {
    login: jest.fn().mockResolvedValue({
      accessToken: 'signed.jwt.token',
      user: { id: 'user-1', email: 'marie@example.com' },
    }),
    register: jest.fn().mockResolvedValue({
      accessToken: 'signed.jwt.token',
      user: { id: 'user-1', email: 'marie@example.com' },
    }),
  };

  /** Double de `RoutesService` : aucune source externe n'est contactée pendant le test. */
  const routesService = {
    plan: jest.fn().mockResolvedValue({ itineraries: [], sources: [], sortedBy: 'carbon' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_OPTIONS)],
      controllers: [AuthController, RoutesController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: RoutesService, useValue: routesService },
        // Le guard JWT n'est volontairement pas monté : on mesure le plafond,
        // pas l'authentification (déjà couverte par jwt-auth.guard.spec.ts).
        { provide: APP_GUARD, useClass: IpThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    // `@CurrentUser()` lit `request.user`, normalement posé par la stratégie JWT
    // (absente ici). On l'injecte pour que le contrôleur du planificateur
    // s'exécute : ce test mesure le plafond, pas l'authentification.
    app.use((request: { user?: unknown }, _response: unknown, next: () => void) => {
      request.user = { userId: 'user-1', email: 'marie@example.com' };
      next();
    });

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** Envoie `count` requêtes séquentielles et rend la liste des statuts obtenus. */
  async function hammer(path: string, body: object, count: number): Promise<number[]> {
    const statuses: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const response = await request(app.getHttpServer() as App)
        .post(path)
        .send(body);
      statuses.push(response.status);
    }
    return statuses;
  }

  const credentials = { email: 'marie@example.com', password: 'Sup3r-Secret!' };

  it(`laisse passer ${AUTH_THROTTLE_LIMIT} tentatives de connexion, puis coupe la suivante`, async () => {
    const statuses = await hammer('/auth/login', credentials, AUTH_THROTTLE_LIMIT + 1);

    expect(statuses.slice(0, AUTH_THROTTLE_LIMIT)).toEqual(
      Array<number>(AUTH_THROTTLE_LIMIT).fill(200),
    );
    expect(statuses.at(-1)).toBe(429);
  });

  it('coupe avant même de consulter le service : la requête refusée ne touche pas la base', async () => {
    await hammer('/auth/login', credentials, AUTH_THROTTLE_LIMIT + 3);

    // Le service n'a été appelé que pour les tentatives autorisées : les
    // requêtes en excès sont rejetées par le guard, en amont du contrôleur.
    expect(authService.login).toHaveBeenCalledTimes(AUTH_THROTTLE_LIMIT);
  });

  it('ne révèle rien dans le 429 : ni compte visé, ni tentatives restantes', async () => {
    const responses = await hammer('/auth/login', credentials, AUTH_THROTTLE_LIMIT + 1);
    expect(responses.at(-1)).toBe(429);

    const blocked = await request(app.getHttpServer() as App)
      .post('/auth/login')
      .send(credentials);

    expect(blocked.status).toBe(429);
    expect(JSON.stringify(blocked.body)).not.toContain(credentials.email);
  });

  it("applique le même plafond à l'inscription (création de comptes en masse)", async () => {
    const statuses = await hammer('/auth/register', credentials, AUTH_THROTTLE_LIMIT + 1);

    expect(statuses.at(-1)).toBe(429);
  });

  it('compte séparément chaque endpoint : saturer le login ne bloque pas le planificateur', async () => {
    await hammer('/auth/login', credentials, AUTH_THROTTLE_LIMIT + 1);

    const plan = await request(app.getHttpServer() as App)
      .post('/routes/plan')
      .send({ from: { lat: 45.76, lon: 4.86 }, to: { lat: 45.757, lon: 4.832 } });

    expect(plan.status).not.toBe(429);
  });

  it('plafonne le planificateur, endpoint le plus coûteux du système', async () => {
    const trip = { from: { lat: 45.76, lon: 4.86 }, to: { lat: 45.757, lon: 4.832 } };
    const statuses = await hammer('/routes/plan', trip, PLAN_THROTTLE_LIMIT + 1);

    expect(statuses.at(-1)).toBe(429);
    expect(routesService.plan).toHaveBeenCalledTimes(PLAN_THROTTLE_LIMIT);
  });

  it('garde un plafond global bien au-dessus des seuils sensibles', () => {
    // Le plafond global est un garde-fou anti-abus, pas la défense anti-brute-force :
    // s'il devenait plus strict que les seuils dédiés, ceux-ci ne serviraient plus à rien.
    expect(GLOBAL_THROTTLE.limit).toBeGreaterThan(PLAN_THROTTLE_LIMIT);
    expect(GLOBAL_THROTTLE.limit).toBeGreaterThan(AUTH_THROTTLE_LIMIT);
  });
});

/**
 * Recette 3 d'UF-802 : le planificateur est **public** depuis UF-801, et son
 * plafond doit tenir sans compte, par IP.
 *
 * Cette seconde suite complète la première sur un point qu'elle ne pouvait pas
 * couvrir : elle ne pose aucun `request.user`, et fait varier l'adresse
 * d'origine des requêtes. C'est là que se joue l'efficacité réelle du plafond —
 * un compteur juste sur une seule IP ne prouve rien tant qu'on n'a pas montré
 * qu'on ne s'en fabrique pas un neuf à volonté.
 *
 * `X-Forwarded-For` sert ici à simuler des clients différents : c'est
 * exactement l'en-tête qu'Express lit pour établir `req.ip` quand — et
 * seulement quand — `trust proxy` est configuré. Les deux réglages sont donc
 * testés, y compris celui où l'en-tête doit être **ignoré**.
 */
describe('Rate limiting en accès public (UF-802 — C4 / OWASP A04)', () => {
  let app: INestApplication;

  const authService = {
    login: jest.fn().mockResolvedValue({
      accessToken: 'signed.jwt.token',
      user: { id: 'user-1', email: 'marie@example.com' },
    }),
    register: jest.fn().mockResolvedValue({ accessToken: 'signed.jwt.token', user: {} }),
  };

  const routesService = {
    plan: jest.fn().mockResolvedValue({ itineraries: [], sources: [], sortedBy: 'carbon' }),
  };

  /**
   * Monte l'API sans aucun utilisateur injecté : toutes les requêtes émises
   * ensuite sont celles d'un **visiteur**, comme depuis UF-801.
   *
   * @param trustedProxies Valeur de `trust proxy` (0 = exposition directe)
   */
  async function createApp(trustedProxies: number): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_OPTIONS)],
      controllers: [AuthController, RoutesController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: RoutesService, useValue: routesService },
        { provide: APP_GUARD, useClass: IpThrottlerGuard },
      ],
    }).compile();

    const created = moduleRef.createNestApplication<NestExpressApplication>();
    // Miroir de `main.ts` : la confiance au proxy est un réglage de déploiement,
    // jamais une valeur par défaut.
    if (trustedProxies > 0) created.set('trust proxy', trustedProxies);
    await created.init();
    return created;
  }

  const TRIP = { from: { lat: 45.76, lon: 4.86 }, to: { lat: 45.757, lon: 4.832 } };
  const CREDENTIALS = { email: 'marie@example.com', password: 'Sup3r-Secret!' };

  /** Envoie `count` requêtes séquentielles depuis `clientIp` et rend les statuts. */
  async function hammerFrom(
    path: string,
    body: object,
    count: number,
    clientIp?: string,
  ): Promise<number[]> {
    const statuses: number[] = [];
    for (let i = 0; i < count; i += 1) {
      let pending = request(app.getHttpServer() as App).post(path);
      if (clientIp) pending = pending.set('X-Forwarded-For', clientIp);
      const response = await pending.send(body);
      statuses.push(response.status);
    }
    return statuses;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('derrière un reverse proxy de confiance (TRUST_PROXY=1)', () => {
    beforeEach(async () => {
      app = await createApp(1);
    });

    it('plafonne un visiteur sans jeton comme n’importe qui d’autre', async () => {
      const statuses = await hammerFrom(
        '/routes/plan',
        TRIP,
        PLAN_THROTTLE_LIMIT + 1,
        '203.0.113.10',
      );

      // Aucune requête ne porte de session : l'accès invité ouvert par UF-801
      // reste sous plafond, et le refus intervient avant le service.
      expect(statuses.slice(0, PLAN_THROTTLE_LIMIT)).toEqual(
        Array<number>(PLAN_THROTTLE_LIMIT).fill(200),
      );
      expect(statuses.at(-1)).toBe(429);
      expect(routesService.plan).toHaveBeenCalledTimes(PLAN_THROTTLE_LIMIT);
    });

    it('ne fait pas payer à un client l’abus de son voisin', async () => {
      await hammerFrom('/auth/login', CREDENTIALS, AUTH_THROTTLE_LIMIT + 1, '203.0.113.10');

      const neighbour = await request(app.getHttpServer() as App)
        .post('/auth/login')
        .set('X-Forwarded-For', '203.0.113.11')
        .send(CREDENTIALS);

      // Recette 4 : un usage normal n'est jamais puni pour le compte d'autrui —
      // et c'est précisément ce qu'un compteur unique par proxy produirait.
      expect(neighbour.status).toBe(200);
    });

    it('ne laisse pas un client IPv6 se refaire un compteur dans son propre /64', async () => {
      // Un abonné IPv6 change d'adresse à volonté dans son bloc (RFC 4941).
      // Compté à l'adresse près, il repartirait de zéro à chaque requête.
      await hammerFrom('/auth/login', CREDENTIALS, AUTH_THROTTLE_LIMIT, '2001:db8:1:2::1');

      const renamed = await request(app.getHttpServer() as App)
        .post('/auth/login')
        .set('X-Forwarded-For', '2001:db8:1:2:dead:beef:cafe:1234')
        .send(CREDENTIALS);

      expect(renamed.status).toBe(429);
    });

    it('laisse passer un client d’un autre réseau /64', async () => {
      await hammerFrom('/auth/login', CREDENTIALS, AUTH_THROTTLE_LIMIT + 1, '2001:db8:1:2::1');

      const elsewhere = await request(app.getHttpServer() as App)
        .post('/auth/login')
        .set('X-Forwarded-For', '2001:db8:1:3::1')
        .send(CREDENTIALS);

      expect(elsewhere.status).toBe(200);
    });
  });

  describe('en exposition directe (TRUST_PROXY absent)', () => {
    beforeEach(async () => {
      app = await createApp(0);
    });

    it('ignore un X-Forwarded-For forgé : le plafond n’est pas contournable', async () => {
      // Sans proxy déclaré, l'en-tête est une donnée fournie par l'attaquant.
      // La lire reviendrait à lui laisser choisir son propre compteur.
      const statuses: number[] = [];
      for (let i = 0; i <= AUTH_THROTTLE_LIMIT; i += 1) {
        const response = await request(app.getHttpServer() as App)
          .post('/auth/login')
          .set('X-Forwarded-For', `198.51.100.${i}`)
          .send(CREDENTIALS);
        statuses.push(response.status);
      }

      expect(statuses.at(-1)).toBe(429);
    });
  });
});
