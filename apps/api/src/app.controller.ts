import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from './common/decorators/public.decorator';

/**
 * Endpoints transverses de l'API (santé du service).
 * Couvre : C10 (supervision basique pour diagnostiquer la connectivité).
 */
@ApiTags('health')
@Controller()
export class AppController {
  /** Sonde de vie : permet au front et aux outils de vérifier que l'API répond. */
  @Public()
  @Get('health')
  @ApiOperation({ summary: "État de santé de l'API" })
  @ApiOkResponse({ description: "L'API est opérationnelle." })
  getHealth(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
