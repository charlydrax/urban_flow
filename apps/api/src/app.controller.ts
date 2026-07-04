import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from './common/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';

/** Réponse de la sonde de santé (statut API + connectivité BDD). */
export interface HealthResponse {
  status: 'ok';
  db: boolean;
  timestamp: string;
}

/**
 * Endpoints transverses de l'API (santé du service).
 * Couvre : C10 (supervision basique pour diagnostiquer la connectivité API et BDD).
 */
@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sonde de vie : vérifie que l'API répond et que la base de données est
   * joignable (ping `SELECT 1`).
   * Une BDD injoignable ne produit pas d'erreur HTTP : l'API reste up et
   * remonte `db: false` (dégradation gracieuse — C10), le champ sert au
   * diagnostic côté front et outils d'exploitation.
   */
  @Public()
  @Get('health')
  @ApiOperation({ summary: "État de santé de l'API et de la base de données" })
  @ApiOkResponse({ description: "L'API est opérationnelle ; `db` indique si la BDD répond." })
  async getHealth(): Promise<HealthResponse> {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      // Échec du ping déjà journalisé par Prisma : on expose seulement db: false
    }
    return { status: 'ok', db, timestamp: new Date().toISOString() };
  }
}
