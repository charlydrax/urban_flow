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

  /**
   * État des sources de données transport.
   * La source GTFS est réellement sondée depuis UF-302 ; GBFS reste un stub (UF-303).
   */
  @Get('status')
  @ApiOperation({
    summary: 'État des sources GTFS/GBFS',
    description:
      'La source `gtfs` interroge le moteur OpenTripPlanner auto-hébergé et rapporte la ' +
      'période couverte par le GTFS chargé. Elle passe à `down` si le moteur ne répond ' +
      'pas : le planificateur continue alors sans le mode transports en commun (C10).',
  })
  @ApiOkResponse({ description: 'Statut de chaque source de données transport.' })
  getStatus(): Promise<TransportSourceStatus[]> {
    return this.transportService.getStatus();
  }
}
