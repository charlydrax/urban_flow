import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'net';

import { PrismaService } from '../../prisma/prisma.service';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../enums/user-role.enum';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/**
 * Tests du guard de rôle (UF-701) — la recette « 403 si non-admin », vérifiée
 * de bout en bout par HTTP.
 *
 * Même parti pris que `jwt-auth.guard.spec.ts` : une vraie application Nest
 * avec les deux guards globaux dans leur ordre de production, interrogée par
 * `fetch`. C'est le seul montage qui prouve ce que le ticket demande, à savoir
 * que les **deux** codes coexistent — `401` quand l'authentification manque,
 * `403` quand c'est l'autorisation. Un `ExecutionContext` simulé aurait testé
 * la méthode du guard, pas la chaîne qui produit la réponse.
 *
 * La base est remplacée par un double : ce qu'on vérifie ici n'est pas Prisma
 * mais la **règle** — le rôle est lu en base, pas dans le jeton. Le cas décisif
 * est d'ailleurs celui-là : un jeton qui revendique `admin` alors que le compte
 * est un `user` doit être refusé (jeton périmé quant aux droits, ou forgé si le
 * secret fuitait — OWASP A01).
 */
const JWT_SECRET = 'test-secret-uf701-roles-guard';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DELETED_ID = '33333333-3333-4333-8333-333333333333';

/** Rôles en base, indépendants de ce que les jetons revendiquent. */
const ROLES_IN_DATABASE: Record<string, string> = {
  [ADMIN_ID]: UserRole.ADMIN,
  [USER_ID]: UserRole.USER,
};

/** Contrôleur minimal : une route réservée, une route ordinaire. */
@Controller('tools')
class ToolsTestController {
  @Roles(UserRole.ADMIN)
  @Get('reserved')
  reserved(): { ok: true } {
    return { ok: true };
  }

  /** Sans `@Roles()` : tout compte authentifié y accède, comme avant UF-701. */
  @Get('open-to-any-account')
  openToAnyAccount(): { ok: true } {
    return { ok: true };
  }
}

describe('RolesGuard — UF-701', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let baseUrl: string;
  let lookups: number;

  beforeAll(async () => {
    const prismaDouble = {
      user: {
        findUnique: ({ where }: { where: { id: string } }) => {
          lookups += 1;
          const role = ROLES_IN_DATABASE[where.id];
          return Promise.resolve(role ? { role } : null);
        },
      },
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
      controllers: [ToolsTestController],
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: prismaDouble },
        // L'ordre reproduit celui d'`AppModule` : authentifier, puis autoriser.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    jwt = app.get(JwtService);
    await app.init();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    lookups = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Appelle la route avec un jeton signé portant l'identité et le rôle donnés. */
  const call = (path: string, claims?: { sub: string; role?: UserRole }) =>
    fetch(`${baseUrl}${path}`, {
      headers: claims
        ? {
            Authorization: `Bearer ${jwt.sign({ ...claims, email: 'demo@urbanflow.dev' })}`,
          }
        : {},
    });

  it('lets an admin account through', async () => {
    const res = await call('/tools/reserved', { sub: ADMIN_ID, role: UserRole.ADMIN });

    expect(res.status).toBe(200);
  });

  it('refuses a plain user account with 403, not 401', async () => {
    const res = await call('/tools/reserved', { sub: USER_ID, role: UserRole.USER });

    // 403 et non 401 : le compte est authentifié, il lui manque un droit — le
    // renvoyer vers l'écran de connexion ne lui donnerait rien de plus.
    expect(res.status).toBe(403);
  });

  it('answers 401 before any authorisation check when no token is presented', async () => {
    const res = await call('/tools/reserved');

    expect(res.status).toBe(401);
    // Aucune requête en base : l'authentification a tranché avant.
    expect(lookups).toBe(0);
  });

  it('ignores a role claimed by the token when the database says otherwise', async () => {
    // Le cas qui justifie la relecture en base : jeton émis avant une
    // rétrogradation, ou forgé si le secret fuitait.
    const res = await call('/tools/reserved', { sub: USER_ID, role: UserRole.ADMIN });

    expect(res.status).toBe(403);
  });

  it('refuses an account that no longer exists', async () => {
    // Droit à l'effacement (C8) : un jeton valide peut survivre au compte.
    const res = await call('/tools/reserved', { sub: DELETED_ID, role: UserRole.ADMIN });

    expect(res.status).toBe(403);
  });

  it('costs no database lookup on routes that require no role', async () => {
    const res = await call('/tools/open-to-any-account', { sub: USER_ID, role: UserRole.USER });

    expect(res.status).toBe(200);
    // C5 : le guard global ne doit rien coûter aux endpoints non annotés.
    expect(lookups).toBe(0);
  });
});
