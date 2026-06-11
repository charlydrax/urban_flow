import { Module } from '@nestjs/common';

import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

/**
 * Module d'intégration des APIs de transport (F3) : GTFS (transports en commun)
 * et GBFS (vélos/trottinettes en libre-service) — formats standards (C9).
 */
@Module({
  controllers: [TransportController],
  providers: [TransportService],
  exports: [TransportService],
})
export class TransportModule {}
