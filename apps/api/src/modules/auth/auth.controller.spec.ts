import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'net';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Tests des endpoints de session (UF-106) — `GET /auth/me` et `POST /auth/logout`.
 *
 * Ces deux routes portent la moitié serveur de la recette du ticket :
 *  - `me` est la sonde qui permet au front de détecter qu'une session est morte
 *    (absente / falsifiée / expirée → 401, donc redirection vers /login) ;
 *  - `logout` purge le cookie `httpOnly`, seule façon de « vider la session »
 *    puisque le JavaScript du navigateur ne peut pas y toucher (C11).
 *
 * Comme pour UF-104, on passe par la couche HTTP réelle (app Nest + cookie-parser
 * + guard global) : c'est passport-jwt qui vérifie signature et expiration, et
 * c'est le navigateur qui interprète `Set-Cookie` — seul un vrai flux le prouve.
 */
const JWT_SECRET = 'test-secret-uf106-session';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const USER_EMAIL = 'marie@example.com';

describe('AuthController — session (UF-106)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let baseUrl: string;

  beforeAll(async () => {
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
      controllers: [AuthController],
      providers: [
        // register/login ne sont pas sollicités ici : double de test minimal.
        { provide: AuthService, useValue: {} },
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser()); // comme dans main.ts : sans lui, req.cookies est undefined
    jwt = app.get(JwtService);
    await app.init();
    await app.listen(0); // port éphémère
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /auth/me', () => {
    it('returns 401 when no session cookie is present', async () => {
      const res = await fetch(`${baseUrl}/auth/me`);

      expect(res.status).toBe(401);
    });

    it('returns 401 when the session cookie is expired', async () => {
      const expired = jwt.sign({ sub: USER_ID, email: USER_EMAIL }, { expiresIn: '-10s' });

      const res = await fetch(`${baseUrl}/auth/me`, {
        headers: { Cookie: `access_token=${expired}` },
      });

      expect(res.status).toBe(401);
    });

    it('returns 401 when the session cookie is forged (wrong signature)', async () => {
      const forged = jwt.sign({ sub: USER_ID, email: USER_EMAIL }, { secret: 'attacker-secret' });

      const res = await fetch(`${baseUrl}/auth/me`, {
        headers: { Cookie: `access_token=${forged}` },
      });

      expect(res.status).toBe(401);
    });

    it('returns the identity carried by a valid session cookie', async () => {
      const token = jwt.sign({ sub: USER_ID, email: USER_EMAIL });

      const res = await fetch(`${baseUrl}/auth/me`, {
        headers: { Cookie: `access_token=${token}` },
      });

      expect(res.status).toBe(200);
      // L'identité vient du token vérifié (sub → id), jamais d'un champ client (C4).
      await expect(res.json()).resolves.toEqual({ id: USER_ID, email: USER_EMAIL });
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the httpOnly session cookie', async () => {
      const token = jwt.sign({ sub: USER_ID, email: USER_EMAIL });

      const res = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { Cookie: `access_token=${token}` },
      });

      expect(res.status).toBe(204);
      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('access_token=;');
      expect(setCookie).toContain('HttpOnly');
    });

    it('is idempotent: works without any session (already expired)', async () => {
      const res = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });

      // @Public() : purger une session déjà morte ne doit pas renvoyer 401,
      // sinon le cas « 401 → purge + retour login » boucle.
      expect(res.status).toBe(204);
    });
  });
});
