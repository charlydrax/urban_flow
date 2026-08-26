import { Module } from '@nestjs/common';

import { CarbonModule } from '../carbon/carbon.module';
import { TransportModule } from '../transport/transport.module';
import { UsersModule } from '../users/users.module';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { SourceCollectorService } from './sources/source-collector.service';

/**
 * Module planificateur d'itinéraires (F2) — « Service Itinéraire » de
 * l'architecture logique. Orchestre transport (GTFS/GBFS/PostGIS, F3),
 * préférences utilisateur (F1) et calcul carbone.
 *
 * `SourceCollectorService` est un collaborateur **interne** : il n'est pas
 * exporté, parce que l'orchestration parallèle des trois sources (UF-305) est
 * une étape du planificateur, pas un service que d'autres modules auraient à
 * consommer. Le sortir d'ici reviendrait à laisser n'importe qui court-circuiter
 * la lecture des préférences qui la précède.
 */
@Module({
  imports: [TransportModule, UsersModule, CarbonModule],
  controllers: [RoutesController],
  providers: [RoutesService, SourceCollectorService],
})
export class RoutesModule {}
