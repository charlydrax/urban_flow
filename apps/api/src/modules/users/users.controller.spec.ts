import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'net';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Tests HTTP des endpoints de profil (UF-107, UF-603) — `GET/PATCH/DELETE /users/me`.
 *
 * On passe par la couche HTTP réelle (app Nest + cookie-parser + guard global +
 * ValidationPipe identique à `main.ts`), et la persistance est simulée par un
 * **faux Prisma en mémoire** partagé par deux comptes. C'est la seule façon de
 * démontrer la recette 2 du ticket — « un utilisateur ne peut accéder qu'à SON
 * profil (test avec deux comptes) » : un stub par test la rendrait triviale.
 *
 * UF-603 y ajoute le droit à l'effacement : l'entrepôt simule aussi la
 * **cascade** du schéma Prisma (supprimer un compte emporte son profil et son
 * historique), sans quoi le test dirait « la ligne users a disparu » et laisserait
 * passer la fuite qu'on cherche justement à exclure.
 */
const JWT_SECRET = 'test-secret-uf107-profile';

const MARIE = { id: '11111111-1111-4111-8111-111111111111', email: 'marie@example.com' };
const JULIEN = { id: '22222222-2222-4222-8222-222222222222', email: 'julien@example.com' };

/** Ligne `users` du faux entrepôt. */
interface FakeUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  consentAt: Date | null;
}

/** Ligne `mobility_profiles` du faux entrepôt. */
interface FakeProfile {
  id: string;
  userId: string;
  preferredModes: string[];
  priority: string;
  reducedMobility: boolean;
  maxWalkMinutes: number;
  updatedAt: Date;
}

/** Ligne `search_history` du faux entrepôt (UF-603 : ce que la cascade doit emporter). */
interface FakeHistory {
  id: string;
  userId: string;
}

describe('UsersController — profil de mobilité (UF-107) et effacement (UF-603)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let baseUrl: string;
  let users: Map<string, FakeUser>;
  let profiles: Map<string, FakeProfile>;
  let history: Map<string, FakeHistory>;

  /** Session valide du compte donné, sous forme d'en-tête `Cookie`. */
  const sessionOf = (user: { id: string; email: string }) => ({
    Cookie: `access_token=${jwt.sign({ sub: user.id, email: user.email })}`,
  });

  const getProfile = (user: { id: string; email: string }) =>
    fetch(`${baseUrl}/users/me`, { headers: sessionOf(user) });

  const patchProfile = (user: { id: string; email: string }, body: unknown) =>
    fetch(`${baseUrl}/users/me`, {
      method: 'PATCH',
      headers: { ...sessionOf(user), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const deleteAccount = (user: { id: string; email: string }) =>
    fetch(`${baseUrl}/users/me`, { method: 'DELETE', headers: sessionOf(user) });

  beforeAll(async () => {
    users = new Map();
    profiles = new Map();
    history = new Map();

    /**
     * Faux client Prisma : deux Map en mémoire, avec la même sémantique que les
     * appels réellement utilisés par `UsersService` (sélection par clé, upsert,
     * transaction interactive).
     */
    const prismaMock = {
      user: {
        findUnique: ({ where }: { where: { id: string } }) => {
          const user = users.get(where.id);
          if (!user) return Promise.resolve(null);
          return Promise.resolve({ ...user, mobilityProfile: profiles.get(user.id) ?? null });
        },
        findUniqueOrThrow: ({ where }: { where: { id: string } }) => {
          const user = users.get(where.id);
          if (!user) return Promise.reject(new Error('not found'));
          return Promise.resolve({ ...user, mobilityProfile: profiles.get(user.id) ?? null });
        },
        update: ({ where, data }: { where: { id: string }; data: { consentAt: Date | null } }) => {
          const user = users.get(where.id);
          if (!user) return Promise.reject(new Error('not found'));
          users.set(where.id, { ...user, ...data });
          return Promise.resolve(users.get(where.id));
        },
        /*
         * Reproduit la CASCADE déclarée au schéma Prisma : supprimer un compte
         * emporte son profil de mobilité et son historique. Simuler la seule
         * ligne `users` rendrait le test aveugle à ce qui compte (C8).
         */
        delete: ({ where }: { where: { id: string } }) => {
          const user = users.get(where.id);
          if (!user) return Promise.reject(new Error('not found'));
          users.delete(where.id);
          profiles.delete(where.id);
          for (const [id, row] of history) if (row.userId === where.id) history.delete(id);
          return Promise.resolve(user);
        },
      },
      searchHistory: {
        count: ({ where }: { where: { userId: string } }) =>
          Promise.resolve(
            [...history.values()].filter((row) => row.userId === where.userId).length,
          ),
      },
      mobilityProfile: {
        count: ({ where }: { where: { userId: string } }) =>
          Promise.resolve(profiles.has(where.userId) ? 1 : 0),
        findUnique: ({ where }: { where: { userId: string } }) =>
          Promise.resolve(profiles.get(where.userId) ?? null),
        upsert: ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = profiles.get(where.userId);
          const row = existing
            ? { ...existing, ...update, updatedAt: new Date() }
            : ({
                id: `profile-${where.userId}`,
                updatedAt: new Date(),
                ...create,
              } as FakeProfile);
          profiles.set(where.userId, row);
          return Promise.resolve(row);
        },
      },
      $transaction: (callback: (tx: unknown) => unknown) => callback(prismaMock),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET })],
        }),
        PassportModule,
        JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: '15m' } }),
      ],
      controllers: [UsersController],
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    // Mêmes règles qu'en production : toute clé non déclarée est rejetée (C4).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    jwt = app.get(JwtService);
    await app.init();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    users.clear();
    profiles.clear();
    history.clear();
    for (const account of [MARIE, JULIEN]) {
      users.set(account.id, {
        ...account,
        passwordHash: '$argon2id$never-exposed',
        createdAt: new Date('2026-01-15T10:00:00.000Z'),
        consentAt: null,
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('protection par le guard JWT global', () => {
    it('returns 401 on GET /users/me without a session', async () => {
      await expect(fetch(`${baseUrl}/users/me`)).resolves.toMatchObject({ status: 401 });
    });

    it('returns 401 on PATCH /users/me without a session', async () => {
      const res = await fetch(`${baseUrl}/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { maxWalkMinutes: 5 } }),
      });

      expect(res.status).toBe(401);
    });

    it('returns 401 when the session cookie is expired (déconnexion / expiration)', async () => {
      const expired = jwt.sign({ sub: MARIE.id, email: MARIE.email }, { expiresIn: '-10s' });

      const res = await fetch(`${baseUrl}/users/me`, {
        headers: { Cookie: `access_token=${expired}` },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /users/me', () => {
    it('serves the default preferences to a brand new account', async () => {
      const res = await getProfile(MARIE);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        id: MARIE.id,
        email: MARIE.email,
        createdAt: '2026-01-15T10:00:00.000Z',
        geolocationConsentAt: null,
        preferences: {
          preferredModes: ['WALK', 'METRO', 'BIKE'],
          priority: 'GREENEST',
          reducedMobility: false,
          maxWalkMinutes: 15,
        },
      });
    });

    it('never exposes the password hash (C11)', async () => {
      const body = (await (await getProfile(MARIE)).json()) as Record<string, unknown>;

      expect(body).not.toHaveProperty('passwordHash');
    });
  });

  describe('PATCH /users/me', () => {
    it('persists the preferences and serves them back on the next read (recette 1)', async () => {
      const patched = await patchProfile(MARIE, {
        preferences: {
          preferredModes: ['BIKE', 'TRAM'],
          priority: 'FASTEST',
          reducedMobility: true,
          maxWalkMinutes: 30,
        },
      });

      expect(patched.status).toBe(200);

      // Relecture par une requête HTTP indépendante : la persistance est réelle,
      // ce n'est pas l'écho de la requête précédente.
      const reread = (await (await getProfile(MARIE)).json()) as {
        preferences: Record<string, unknown>;
      };
      expect(reread.preferences).toEqual({
        preferredModes: ['BIKE', 'TRAM'],
        priority: 'FASTEST',
        reducedMobility: true,
        maxWalkMinutes: 30,
      });
    });

    it('records and revokes the geolocation consent (C8)', async () => {
      const granted = (await (await patchProfile(MARIE, { geolocationConsent: true })).json()) as {
        geolocationConsentAt: string | null;
      };
      expect(granted.geolocationConsentAt).not.toBeNull();

      const revoked = (await (await patchProfile(MARIE, { geolocationConsent: false })).json()) as {
        geolocationConsentAt: string | null;
      };
      expect(revoked.geolocationConsentAt).toBeNull();
    });

    it('rejects an invalid payload with a 400 (C4)', async () => {
      const res = await patchProfile(MARIE, { preferences: { maxWalkMinutes: 999 } });

      expect(res.status).toBe(400);
    });

    it('rejects an unknown mode with a 400 (C4)', async () => {
      const res = await patchProfile(MARIE, { preferences: { preferredModes: ['HOVERBOARD'] } });

      expect(res.status).toBe(400);
    });

    it('rejects an empty mode list: a profile with no mode yields no route', async () => {
      const res = await patchProfile(MARIE, { preferences: { preferredModes: [] } });

      expect(res.status).toBe(400);
    });

    it('rejects an attempt to target another account through the body (C4 / OWASP A01)', async () => {
      // `userId` n'est pas déclaré dans le DTO : le ValidationPipe le refuse en 400
      // au lieu de le laisser filtrer jusqu'à la requête Prisma.
      const res = await patchProfile(MARIE, {
        userId: JULIEN.id,
        preferences: { maxWalkMinutes: 1 },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('isolation entre comptes (recette 2 — test avec deux comptes)', () => {
    it('each session only ever reads its own profile', async () => {
      await patchProfile(MARIE, { preferences: { maxWalkMinutes: 30 } });
      await patchProfile(JULIEN, { preferences: { maxWalkMinutes: 5 } });

      const marie = (await (await getProfile(MARIE)).json()) as {
        email: string;
        preferences: { maxWalkMinutes: number };
      };
      const julien = (await (await getProfile(JULIEN)).json()) as {
        email: string;
        preferences: { maxWalkMinutes: number };
      };

      expect(marie.email).toBe(MARIE.email);
      expect(marie.preferences.maxWalkMinutes).toBe(30);
      expect(julien.email).toBe(JULIEN.email);
      expect(julien.preferences.maxWalkMinutes).toBe(5);
    });

    it("a write by one account never touches the other's profile", async () => {
      await patchProfile(MARIE, { preferences: { maxWalkMinutes: 30 }, geolocationConsent: true });
      await patchProfile(JULIEN, { preferences: { reducedMobility: true } });

      const marie = (await (await getProfile(MARIE)).json()) as {
        geolocationConsentAt: string | null;
        preferences: { reducedMobility: boolean; maxWalkMinutes: number };
      };
      const julien = (await (await getProfile(JULIEN)).json()) as {
        geolocationConsentAt: string | null;
        preferences: { reducedMobility: boolean; maxWalkMinutes: number };
      };

      expect(marie.preferences.reducedMobility).toBe(false);
      expect(marie.geolocationConsentAt).not.toBeNull();
      // Julien garde ses défauts et n'a jamais consenti : rien n'a fui d'un compte à l'autre.
      expect(julien.preferences.maxWalkMinutes).toBe(15);
      expect(julien.geolocationConsentAt).toBeNull();
    });

    it('erasing one account leaves the other one untouched (UF-603)', async () => {
      await patchProfile(MARIE, { preferences: { maxWalkMinutes: 30 } });
      await patchProfile(JULIEN, { preferences: { maxWalkMinutes: 5 } });
      history.set('h-julien', { id: 'h-julien', userId: JULIEN.id });

      await deleteAccount(MARIE);

      // Julien conserve compte, préférences et historique : la suppression est
      // bornée au porteur du token, faute de pouvoir en désigner un autre.
      const julien = (await (await getProfile(JULIEN)).json()) as {
        preferences: { maxWalkMinutes: number };
      };
      expect(julien.preferences.maxWalkMinutes).toBe(5);
      expect(history.has('h-julien')).toBe(true);
    });
  });

  /** Recette 3 d'UF-603 : effacement effectif du compte ET des données en base. */
  describe('DELETE /users/me — droit à l’effacement (RGPD art. 17)', () => {
    it('returns 401 without a session (an anonymous request erases nothing)', async () => {
      const res = await fetch(`${baseUrl}/users/me`, { method: 'DELETE' });

      expect(res.status).toBe(401);
      expect(users.has(MARIE.id)).toBe(true);
    });

    it('erases the account, its preferences and its trips in one call', async () => {
      await patchProfile(MARIE, {
        preferences: { reducedMobility: true },
        geolocationConsent: true,
      });
      history.set('h-1', { id: 'h-1', userId: MARIE.id });
      history.set('h-2', { id: 'h-2', userId: MARIE.id });

      const res = await deleteAccount(MARIE);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        deletedUserId: MARIE.id,
        deletedSearchHistoryCount: 2,
        deletedMobilityProfile: true,
        deletedAt: expect.any(String),
      });
      // Effacement RÉEL : plus une ligne, dans aucune des trois tables.
      expect(users.has(MARIE.id)).toBe(false);
      expect(profiles.has(MARIE.id)).toBe(false);
      expect([...history.values()].filter((row) => row.userId === MARIE.id)).toEqual([]);
    });

    it('clears the session cookie so the browser stops sending a dead token', async () => {
      const res = await deleteAccount(MARIE);

      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('access_token=');
      // Expiration au 1er janvier 1970 : la marque d'un cookie purgé.
      expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(setCookie).toContain('HttpOnly');
    });

    it('answers 404 to a still-valid token whose account is already gone', async () => {
      await deleteAccount(MARIE);

      // Le JWT reste signé et non expiré : c'est l'absence du compte qui répond.
      const res = await deleteAccount(MARIE);
      expect(res.status).toBe(404);
      await expect(getProfile(MARIE)).resolves.toMatchObject({ status: 404 });
    });
  });
});
