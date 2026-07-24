import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/**
 * Tests du Service d'authentification — inscription (UF-102).
 * Fige les trois critères de recette du ticket :
 *  1. un compte est créé avec un hash argon2 (jamais le mot de passe en clair) ;
 *  2. un email déjà utilisé remonte un 409 (ConflictException), pas un 500 ;
 *  3. l'email est normalisé (trim + minuscules) avant insertion.
 */
describe('AuthService.register', () => {
  let service: AuthService;
  let createUser: jest.Mock;

  const dto: RegisterDto = { email: 'Marie@Example.com', password: 'Tr0p-Secret!2026' };

  beforeEach(async () => {
    createUser = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('signed.jwt') } },
        { provide: PrismaService, useValue: { user: { create: createUser } } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('hashes the password with argon2 and stores the hash, never the plaintext', async () => {
    createUser.mockResolvedValue({ id: 'user-1', email: 'marie@example.com' });

    const result = await service.register(dto);

    const { data } = createUser.mock.calls[0][0] as {
      data: { email: string; passwordHash: string };
    };
    expect(data.passwordHash).not.toBe(dto.password);
    // Le hash produit est bien vérifiable et correspond au mot de passe fourni.
    await expect(argon2.verify(data.passwordHash, dto.password)).resolves.toBe(true);
    expect(result).toEqual({
      accessToken: 'signed.jwt',
      user: { id: 'user-1', email: 'marie@example.com' },
    });
  });

  it('normalizes the email (trim + lowercase) before persisting', async () => {
    createUser.mockResolvedValue({ id: 'user-1', email: 'marie@example.com' });

    await service.register({ email: '  Marie@Example.com  ', password: dto.password });

    const { data } = createUser.mock.calls[0][0] as { data: { email: string } };
    expect(data.email).toBe('marie@example.com');
  });

  it('throws a 409 ConflictException when the email is already taken (P2002)', async () => {
    createUser.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.register(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows unexpected persistence errors (not swallowed as 409)', async () => {
    createUser.mockRejectedValue(new Error('database unreachable'));

    await expect(service.register(dto)).rejects.toThrow('database unreachable');
  });
});

/**
 * Tests du Service d'authentification — connexion (UF-103).
 * Fige les trois critères de recette du ticket :
 *  1. des identifiants valides retournent un JWT (dont le userId réel du compte) ;
 *  2. un mot de passe faux remonte un 401 générique (UnauthorizedException) ;
 *  3. un email inconnu remonte le MÊME 401 générique (anti-énumération OWASP),
 *     sans jamais révéler si c'est l'email ou le mot de passe qui est en cause.
 */
describe('AuthService.login', () => {
  let service: AuthService;
  let findUser: jest.Mock;
  let signAsync: jest.Mock;

  const password = 'Tr0p-Secret!2026';
  const dto: LoginDto = { email: 'Marie@Example.com', password };
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash(password);
  });

  beforeEach(async () => {
    findUser = jest.fn();
    signAsync = jest.fn().mockResolvedValue('signed.jwt');

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: { signAsync } },
        { provide: PrismaService, useValue: { user: { findUnique: findUser } } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('returns a JWT carrying the real account userId when credentials are valid', async () => {
    findUser.mockResolvedValue({ id: 'user-42', email: 'marie@example.com', passwordHash });

    const result = await service.login(dto);

    // L'email est normalisé (trim + lowercase) avant la recherche en base.
    expect(findUser.mock.calls[0][0].where).toEqual({ email: 'marie@example.com' });
    // Le token est signé avec le userId réel (sub), pas un id factice.
    expect(signAsync).toHaveBeenCalledWith({ sub: 'user-42', email: 'marie@example.com' });
    expect(result).toEqual({
      accessToken: 'signed.jwt',
      user: { id: 'user-42', email: 'marie@example.com' },
    });
  });

  it('throws a generic 401 when the password is wrong (no token issued)', async () => {
    findUser.mockResolvedValue({ id: 'user-42', email: 'marie@example.com', passwordHash });

    await expect(service.login({ email: dto.email, password: 'wrong-password' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('throws the same generic 401 when the email is unknown (anti-enumeration)', async () => {
    findUser.mockResolvedValue(null);

    const error = await service.login(dto).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedException);
    // Message identique au cas « mot de passe faux » : ne trahit pas l'existence du compte.
    expect((error as UnauthorizedException).message).toBe('Invalid credentials');
    expect(signAsync).not.toHaveBeenCalled();
  });
});
