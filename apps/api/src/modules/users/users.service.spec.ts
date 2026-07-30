import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { RoutePriority, TransportMode } from './dto/update-user-profile.dto';
import { DEFAULT_PREFERENCES, UsersService } from './users.service';

/**
 * Tests du service Profil de mobilité (UF-107).
 *
 * Fige les critères de recette du ticket :
 *  1. les préférences modifiées sont bien **persistées** (upsert Prisma) et le
 *     profil renvoyé est celui relu en base ;
 *  2. un utilisateur n'accède qu'à SON profil : la clé de toutes les requêtes
 *     est l'identifiant issu du JWT, jamais une donnée du corps (C4/OWASP A01) ;
 *  3. le consentement géolocalisation est horodaté et révocable (C8).
 */
describe('UsersService', () => {
  let service: UsersService;
  let findUser: jest.Mock;
  let findUserOrThrow: jest.Mock;
  let updateUser: jest.Mock;
  let upsertProfile: jest.Mock;
  let findProfile: jest.Mock;

  const createdAt = new Date('2026-01-15T10:00:00.000Z');

  /** Ligne base d'un compte, avec son profil de mobilité éventuel. */
  const dbUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'marie@example.com',
    createdAt,
    consentAt: null,
    mobilityProfile: null,
    ...overrides,
  });

  /** Ligne base d'un profil de mobilité complet. */
  const dbProfile = (overrides: Record<string, unknown> = {}) => ({
    id: 'profile-1',
    userId: 'user-1',
    preferredModes: ['BIKE', 'TRAM'],
    priority: 'FASTEST',
    reducedMobility: true,
    maxWalkMinutes: 25,
    updatedAt: createdAt,
    ...overrides,
  });

  beforeEach(async () => {
    findUser = jest.fn();
    findUserOrThrow = jest.fn();
    updateUser = jest.fn();
    upsertProfile = jest.fn();
    findProfile = jest.fn();

    const prismaMock: Record<string, unknown> = {
      user: { findUnique: findUser, findUniqueOrThrow: findUserOrThrow, update: updateUser },
      mobilityProfile: { upsert: upsertProfile, findUnique: findProfile },
    };
    // Transaction interactive : on exécute le callback avec le client mocké,
    // ce qui vérifie au passage que TOUTES les écritures y passent (atomicité).
    prismaMock.$transaction = jest.fn((callback: (tx: unknown) => unknown) => callback(prismaMock));

    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('getProfile', () => {
    it('reads the profile with the userId from the token as the query key', async () => {
      findUser.mockResolvedValue(dbUser({ mobilityProfile: dbProfile() }));

      const profile = await service.getProfile('user-1');

      // Recette 2 : la requête est verrouillée sur l'identifiant du token.
      expect(findUser.mock.calls[0][0].where).toEqual({ id: 'user-1' });
      expect(profile).toEqual({
        id: 'user-1',
        email: 'marie@example.com',
        createdAt: createdAt.toISOString(),
        geolocationConsentAt: null,
        preferences: {
          preferredModes: [TransportMode.BIKE, TransportMode.TRAM],
          priority: RoutePriority.FASTEST,
          reducedMobility: true,
          maxWalkMinutes: 25,
        },
      });
    });

    it('never selects the password hash (C11)', async () => {
      findUser.mockResolvedValue(dbUser());

      await service.getProfile('user-1');

      const { select } = findUser.mock.calls[0][0] as { select: Record<string, boolean> };
      expect(select.passwordHash).toBeUndefined();
    });

    it('serves the default preferences without writing anything when none are saved yet', async () => {
      findUser.mockResolvedValue(dbUser());

      const profile = await service.getProfile('user-1');

      expect(profile.preferences).toEqual(DEFAULT_PREFERENCES);
      // Une lecture ne doit rien créer en base (C5).
      expect(upsertProfile).not.toHaveBeenCalled();
    });

    it('exposes the geolocation consent timestamp in ISO 8601 (C8)', async () => {
      const consentAt = new Date('2026-07-01T08:30:00.000Z');
      findUser.mockResolvedValue(dbUser({ consentAt }));

      const profile = await service.getProfile('user-1');

      expect(profile.geolocationConsentAt).toBe(consentAt.toISOString());
    });

    it('ignores modes that are no longer part of the catalogue', async () => {
      findUser.mockResolvedValue(
        dbUser({ mobilityProfile: dbProfile({ preferredModes: ['BIKE', 'HOVERBOARD'] }) }),
      );

      const profile = await service.getProfile('user-1');

      expect(profile.preferences.preferredModes).toEqual([TransportMode.BIKE]);
    });

    it('throws a 404 when the account no longer exists (token still valid)', async () => {
      findUser.mockResolvedValue(null);

      await expect(service.getProfile('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('persists the submitted preferences under the userId from the token', async () => {
      findUser.mockResolvedValue(dbUser({ mobilityProfile: dbProfile() }));
      findUserOrThrow.mockResolvedValue(
        dbUser({
          mobilityProfile: dbProfile({ preferredModes: ['WALK'], maxWalkMinutes: 5 }),
        }),
      );

      const result = await service.updateProfile('user-1', {
        preferences: { preferredModes: [TransportMode.WALK], maxWalkMinutes: 5 },
      });

      expect(upsertProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          update: { preferredModes: [TransportMode.WALK], maxWalkMinutes: 5 },
        }),
      );
      // Le profil renvoyé est relu après écriture, pas un écho de l'entrée.
      expect(findUserOrThrow).toHaveBeenCalled();
      expect(result.preferences.maxWalkMinutes).toBe(5);
    });

    it('leaves untouched fields alone (PATCH is partial)', async () => {
      findUser.mockResolvedValue(dbUser({ mobilityProfile: dbProfile() }));
      findUserOrThrow.mockResolvedValue(dbUser({ mobilityProfile: dbProfile() }));

      await service.updateProfile('user-1', { preferences: { reducedMobility: false } });

      const { update } = upsertProfile.mock.calls[0][0] as { update: Record<string, unknown> };
      expect(update).toEqual({ reducedMobility: false });
      expect(Object.keys(update)).not.toContain('preferredModes');
    });

    it('falls back to the product defaults when creating the very first profile row', async () => {
      findUser.mockResolvedValue(dbUser());
      findUserOrThrow.mockResolvedValue(dbUser({ mobilityProfile: dbProfile() }));

      await service.updateProfile('user-1', { preferences: { maxWalkMinutes: 40 } });

      const { create } = upsertProfile.mock.calls[0][0] as { create: Record<string, unknown> };
      expect(create).toEqual({ userId: 'user-1', ...DEFAULT_PREFERENCES, maxWalkMinutes: 40 });
    });

    it('stamps the geolocation consent when it is granted (C8)', async () => {
      findUser.mockResolvedValue(dbUser({ consentAt: null }));
      findUserOrThrow.mockResolvedValue(dbUser({ consentAt: new Date() }));

      await service.updateProfile('user-1', { geolocationConsent: true });

      const { where, data } = updateUser.mock.calls[0][0] as {
        where: { id: string };
        data: { consentAt: Date | null };
      };
      expect(where).toEqual({ id: 'user-1' });
      expect(data.consentAt).toBeInstanceOf(Date);
    });

    it('clears the geolocation consent when it is revoked (C8 — revocable)', async () => {
      findUser.mockResolvedValue(dbUser({ consentAt: new Date('2026-07-01T08:30:00.000Z') }));
      findUserOrThrow.mockResolvedValue(dbUser({ consentAt: null }));

      await service.updateProfile('user-1', { geolocationConsent: false });

      expect(updateUser.mock.calls[0][0].data).toEqual({ consentAt: null });
    });

    it('does not re-stamp a consent that is already granted (audit trail — C8)', async () => {
      findUser.mockResolvedValue(dbUser({ consentAt: new Date('2026-07-01T08:30:00.000Z') }));
      findUserOrThrow.mockResolvedValue(
        dbUser({ consentAt: new Date('2026-07-01T08:30:00.000Z') }),
      );

      await service.updateProfile('user-1', { geolocationConsent: true });

      expect(updateUser).not.toHaveBeenCalled();
    });

    it('throws a 404 without writing anything when the account no longer exists', async () => {
      findUser.mockResolvedValue(null);

      await expect(
        service.updateProfile('ghost', { preferences: { maxWalkMinutes: 10 } }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(upsertProfile).not.toHaveBeenCalled();
      expect(updateUser).not.toHaveBeenCalled();
    });
  });
});
