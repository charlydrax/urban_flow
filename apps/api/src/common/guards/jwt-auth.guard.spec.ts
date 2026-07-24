import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';

import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
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
    await expect(res.json()).resolves.toEqual({ userId: USER_ID, email: USER_EMAIL });
  });

  it('lets a @Public() route through without any token', async () => {
    const res = await fetch(`${baseUrl}/protected/open`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
