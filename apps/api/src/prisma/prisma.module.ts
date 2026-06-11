import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Module d'accès aux données (PostgreSQL + PostGIS via Prisma).
 * Déclaré `@Global()` : un seul pool de connexions partagé par tous les modules (C5/C10).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
