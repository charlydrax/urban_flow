import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { TransportService, TransportSourceStatus } from './transport.service';

/**
 * Contrôleur des intégrations transport (F3).
 * Expose l'état des sources GTFS/GBFS pour le diagnostic et l'affichage
 * d'un mode dégradé côté client (C10).
 */
@ApiTags('transport')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@Controller('transport')
export class TransportController {
  constructor(private readonly transportService: TransportService) {}

  /** État des sources de données transport (stub). */
  @Get('status')
  @ApiOperation({ summary: 'État des sources GTFS/GBFS (stub)' })
  @ApiOkResponse({ description: 'Statut de chaque source de données transport.' })
  getStatus(): Promise<TransportSourceStatus[]> {
    return this.transportService.getStatus();
  }
}
