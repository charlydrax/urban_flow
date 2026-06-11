import { Module } from '@nestjs/common';

import { CarbonModule } from '../carbon/carbon.module';
import { TransportModule } from '../transport/transport.module';
import { UsersModule } from '../users/users.module';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';

/**
 * Module planificateur d'itinéraires (F2) — « Service Itinéraire » de
 * l'architecture logique. Orchestre transport (GTFS/GBFS, F3), préférences
 * utilisateur (F1) et calcul carbone.
 */
@Module({
  imports: [TransportModule, UsersModule, CarbonModule],
  controllers: [RoutesController],
  providers: [RoutesService],
})
export class RoutesModule {}
