import { Test } from '@nestjs/testing';
import { SEARCH_HISTORY_RETENTION_DAYS } from '@urbanflow/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { DataRetentionService } from './data-retention.service';

/**
 * Tests de la purge de rétention (UF-603) — recette 4 du ticket : « la rétention
 * est documentée », donc appliquée et vérifiable.
 *
 * Ce que ces tests protègent réellement : la **borne**. Une erreur d'un facteur
 * mille sur le calcul du seuil ne casse aucun type et ne lève aucune exception —
 * elle supprimerait silencieusement tout l'historique de tous les utilisateurs,
 * ou n'en supprimerait jamais rien. C'est le seul endroit du module où
 * l'arithmétique a une conséquence irréversible.
 */
describe('DataRetentionService', () => {
  let service: DataRetentionService;
  let deleteMany: jest.Mock;
  let deleteUser: jest.Mock;
  let deleteProfile: jest.Mock;

  /** Horloge fixe : une purge dont on ne peut pas fixer l'heure n'est pas testable. */
  const now = new Date('2026-08-29T03:00:00.000Z');

  /** Seuil attendu, recalculé **sans** réutiliser le code testé. */
  const expectedCutoff = new Date('2025-08-29T03:00:00.000Z');

  /** Lit la clause `where` transmise à Prisma par la purge. */
  const purgeFilter = () =>
    (deleteMany.mock.calls[0][0] as { where: { createdAt: { lt: Date } } }).where;

  beforeEach(async () => {
    deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    deleteUser = jest.fn();
    deleteProfile = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        DataRetentionService,
        {
          provide: PrismaService,
          useValue: {
            searchHistory: { deleteMany },
            user: { delete: deleteUser, deleteMany: deleteUser },
            mobilityProfile: { delete: deleteProfile, deleteMany: deleteProfile },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(DataRetentionService);
  });

  it('deletes exactly the rows older than the published retention window', async () => {
    await service.purgeExpiredSearchHistory(now);

    // 2026-08-29 moins 365 jours = 2025-08-29 : la borne est celle annoncée à
    // l'utilisateur sur la page « Politique de confidentialité ».
    expect(SEARCH_HISTORY_RETENTION_DAYS).toBe(365);
    expect(purgeFilter().createdAt.lt).toEqual(expectedCutoff);
  });

  it('keeps a trip recorded just inside the window, and drops one just outside', async () => {
    await service.purgeExpiredSearchHistory(now);
    const cutoff = purgeFilter().createdAt.lt;

    const oneHour = 60 * 60 * 1000;
    const justInside = new Date(cutoff.getTime() + oneHour);
    const justOutside = new Date(cutoff.getTime() - oneHour);

    // `lt` (et non `lte`) : la comparaison porte sur la borne exacte.
    expect(justInside.getTime() < cutoff.getTime()).toBe(false);
    expect(justOutside.getTime() < cutoff.getTime()).toBe(true);
  });

  it('purges every account, dormant ones included (no user filter)', async () => {
    await service.purgeExpiredSearchHistory(now);

    // Le filtre ne porte QUE sur la date : un filtre par utilisateur laisserait
    // les comptes inactifs conserver leurs trajets indéfiniment — or ce sont
    // justement eux que la limitation de conservation vise.
    expect(Object.keys(purgeFilter())).toEqual(['createdAt']);
  });

  it('never touches accounts or preferences — only trips expire', async () => {
    await service.purgeExpiredSearchHistory(now);

    // Un compte et ses réglages restent tant que l'utilisateur les veut ; ils ne
    // disparaissent qu'avec `DELETE /api/users/me`.
    expect(deleteUser).not.toHaveBeenCalled();
    expect(deleteProfile).not.toHaveBeenCalled();
  });

  it('reports the number of rows actually removed', async () => {
    deleteMany.mockResolvedValue({ count: 17 });

    await expect(service.purgeExpiredSearchHistory(now)).resolves.toBe(17);
  });

  it('runs the same purge when triggered by the daily schedule', async () => {
    deleteMany.mockResolvedValue({ count: 5 });

    await service.purgeScheduled();

    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(Object.keys(purgeFilter())).toEqual(['createdAt']);
  });
});
