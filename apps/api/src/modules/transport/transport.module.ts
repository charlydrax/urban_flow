import { Module } from '@nestjs/common';

import { GbfsClient } from './gbfs/gbfs.client';
import { OtpClient } from './otp/otp.client';
import { SharedMobilityService } from './shared-mobility.service';
import { TransitService } from './transit.service';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

/**
 * Module d'intégration des APIs de transport (F3) : GTFS (transports en commun)
 * et GBFS (vélos/trottinettes en libre-service) — formats standards (C9).
 *
 * `TransitService` et `SharedMobilityService` sont exportés : ce sont les deux
 * sources que le Service Itinéraire (module `routes`) appellera en parallèle
 * pour construire des itinéraires multimodaux (UF-305). `OtpClient` et
 * `GbfsClient` restent internes au module — ni le protocole du moteur de
 * routage ni la structure des flux GBFS ne doivent fuiter ailleurs.
 */
@Module({
  controllers: [TransportController],
  providers: [GbfsClient, OtpClient, SharedMobilityService, TransitService, TransportService],
  exports: [SharedMobilityService, TransitService, TransportService],
})
export class TransportModule {}
