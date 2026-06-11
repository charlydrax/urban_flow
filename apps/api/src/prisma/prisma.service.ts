import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Service Prisma : client unique vers PostgreSQL + PostGIS.
 *
 * Les requêtes géospatiales (ex. `ST_DWithin` pour les pistes cyclables proches,
 * cf. CLAUDE.md section 4) passeront par `$queryRaw` car Prisma ne couvre pas
 * nativement les types PostGIS.
 *
 * La connexion est tentée au démarrage mais un échec ne bloque pas le boot :
 * les endpoints stubs actuels n'utilisent pas la base, et le squelette doit
 * pouvoir démarrer sans Docker (dégradation gracieuse — C10). L'erreur est
 * journalisée clairement pour le diagnostic.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      this.logger.error(
        'Database unreachable - start it with `docker compose up -d` (endpoints using the DB will fail)',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
