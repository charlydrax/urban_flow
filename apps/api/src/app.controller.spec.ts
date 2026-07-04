import { Test } from '@nestjs/testing';

import { AppController } from './app.controller';
import { PrismaService } from './prisma/prisma.service';

/**
 * Tests de la sonde de santé (F-005) : l'endpoint doit refléter l'état réel
 * de la connectivité BDD sans jamais faire tomber l'API (C10).
 */
describe('AppController — GET /api/health', () => {
  const prismaMock = { $queryRaw: jest.fn() };
  let controller: AppController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: PrismaService, useValue: prismaMock }],
    }).compile();
    controller = moduleRef.get(AppController);
  });

  it('retourne status ok et db: true quand le ping BDD réussit', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    const result = await controller.getHealth();

    expect(result.status).toBe('ok');
    expect(result.db).toBe(true);
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it('retourne db: false sans lever d’erreur quand la BDD est injoignable', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    const result = await controller.getHealth();

    expect(result.status).toBe('ok');
    expect(result.db).toBe(false);
  });
});
