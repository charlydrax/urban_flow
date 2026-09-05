import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'net';

import { CurrentUser } from '../decorators/current-user.decorator';
import { OptionalAuth } from '../decorators/optional-auth.decorator';
import { OptionalUser } from '../decorators/optional-user.decorator';
import { Public } from '../decorators/public.decorator';
import { UserRole } from '../enums/user-role.enum';
import { AuthenticatedUser, JwtStrategy } from '../strategies/jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Tests du guard JWT global (UF-104) — vérification de bout en bout via HTTP.
 *
 * On démarre une vraie app Nest (guard + stratégie Passport branchés) exposant
 * une route protégée de test, puis on l'interroge avec `fetch` pour figer les
 * trois critères de recette du ticket :
 *  1. une route protégée SANS token retourne 401 ;
 *  2. un token expiré OU falsifié (mauvaise signature) retourne 401 ;
 *  3. un token valide donne accès et expose bien le userId (issu du `sub`).
 *
 * UF-801 y ajoute le régime **facultatif** (`@OptionalAuth()`), dont tout
 * l'intérêt tient dans la distinction que `@Public()` ne sait pas faire : un
 * jeton valide doit continuer de renseigner `request.user`, une requête sans
 * jeton doit passer en invité, et un jeton **présenté mais rejeté** doit rester
 * un 401 — sinon une session expirée dégraderait l'utilisateur en anonyme sans
 * que rien ne le lui dise.
 *
 * Le test passe par la couche HTTP réelle (et non un ExecutionContext simulé)
 * car c'est passport-jwt qui vérifie signature et expiration : seul un vrai
 * flux prouve ces comportements. `fetch` natif (Node 18+) évite d'ajouter
 * `supertest` en dépendance.
 */
const JWT_SECRET = 'test-secret-uf104-guard';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER_EMAIL = 'marie@example.com';

/** Contrôleur minimal dédié au test : une route protégée + une route publique. */
@Controller('protected')
class ProtectedTestController {
  /** Protégée par le guard global : renvoie l'identité extraite du token. */
  @Get()
  whoami(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /** Opt-out explicite : doit rester accessible sans token. */
  @Public()
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }

  /**
   * Régime facultatif (UF-801) : accessible sans token, mais l'identité reste
   * exposée quand un token valide accompagne la requête.
   */
  @OptionalAuth()
  @Get('optional')
  optional(@OptionalUser() user: AuthenticatedUser | null): { user: AuthenticatedUser | null } {
    return { user };
  }

  /**
   * Même régime, mais lu par `@Public()` : sert à démontrer *dans le test* la
   * raison pour laquelle UF-801 n'a pas pu s'en contenter.
   */
  @Public()
  @Get('open-user')
  openUser(@OptionalUser() user: AuthenticatedUser | null): { user: AuthenticatedUser | null } {
    return { user };
  }
}

describe('JwtAuthGuard (global) — UF-104', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        // Fournit JWT_SECRET à la stratégie sans dépendre d'un vrai fichier .env.
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET })],
        }),
        PassportModule,
        JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: '15m' } }),
      ],
      controllers: [ProtectedTestController],
      providers: [JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    // Même branchement que `main.ts` : sans lui, `req.cookies` n'existe pas et
    // l'extraction depuis le cookie httpOnly (C11) ne serait pas testable.
    app.use(cookieParser());
    jwt = app.get(JwtService);
    await app.init();
    await app.listen(0); // port éphémère
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 on a protected route when no token is provided', async () => {
    const res = await fetch(`${baseUrl}/protected`);

    expect(res.status).toBe(401);
  });

  it('returns 401 when the token signature is forged (wrong secret)', async () => {
    const forged = jwt.sign({ sub: USER_ID, email: USER_EMAIL }, { secret: 'attacker-secret' });

    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${forged}` },
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 when the token is expired', async () => {
    const expired = jwt.sign({ sub: USER_ID, email: USER_EMAIL }, { expiresIn: '-10s' });

    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${expired}` },
    });

    expect(res.status).toBe(401);
  });

  it('grants access with a valid token and exposes the userId from the token', async () => {
    const token = jwt.sign({ sub: USER_ID, email: USER_EMAIL });

    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    // L'identité provient du token vérifié (sub → userId), pas du corps de requête.
    // `role` absent du jeton (émis sans revendication) : la stratégie retombe
    // sur le rôle par défaut, jamais sur un privilège (UF-701).
    await expect(res.json()).resolves.toEqual({
      userId: USER_ID,
      email: USER_EMAIL,
      role: UserRole.USER,
    });
  });

  it('lets a @Public() route through without any token', async () => {
    const res = await fetch(`${baseUrl}/protected/open`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
  describe('@OptionalAuth() — accès invité (UF-801)', () => {
    it('lets an anonymous visitor through, with no user attached', async () => {
      const res = await fetch(`${baseUrl}/protected/optional`);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ user: null });
    });

    it('still exposes the identity when a valid token is presented', async () => {
      const token = jwt.sign({ sub: USER_ID, email: USER_EMAIL });

      const res = await fetch(`${baseUrl}/protected/optional`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      // C'est LA différence avec `@Public()` : le parcours connecté survit à
      // l'ouverture de la route aux invités.
      await expect(res.json()).resolves.toEqual({
        user: { userId: USER_ID, email: USER_EMAIL, role: UserRole.USER },
      });
    });

    it('still returns 401 when a presented token is expired', async () => {
      const expired = jwt.sign({ sub: USER_ID, email: USER_EMAIL }, { expiresIn: '-10s' });

      const res = await fetch(`${baseUrl}/protected/optional`, {
        headers: { Authorization: `Bearer ${expired}` },
      });

      // Une session morte n'est pas une absence de compte : la dégrader en
      // visite anonyme priverait l'utilisateur de son historique en silence.
      expect(res.status).toBe(401);
    });

    it('still returns 401 when a presented token is forged', async () => {
      const forged = jwt.sign({ sub: USER_ID, email: USER_EMAIL }, { secret: 'attacker-secret' });

      const res = await fetch(`${baseUrl}/protected/optional`, {
        headers: { Authorization: `Bearer ${forged}` },
      });

      expect(res.status).toBe(401);
    });

    it('reads a token from the httpOnly cookie as well as the header (C11)', async () => {
      const token = jwt.sign({ sub: USER_ID, email: USER_EMAIL });

      const res = await fetch(`${baseUrl}/protected/optional`, {
        headers: { Cookie: `access_token=${token}` },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        user: { userId: USER_ID, email: USER_EMAIL, role: UserRole.USER },
      });
    });

    it('shows why @Public() could not have been used instead', async () => {
      const token = jwt.sign({ sub: USER_ID, email: USER_EMAIL });

      const res = await fetch(`${baseUrl}/protected/open-user`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Même jeton, même appelant : sur une route `@Public()`, la stratégie
      // n'est jamais jouée et l'utilisateur connecté arrive anonyme.
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ user: null });
    });
  });
});
