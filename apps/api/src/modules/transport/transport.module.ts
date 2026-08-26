import { Module } from '@nestjs/common';

import { CyclePathsService } from './cycle-paths/cycle-paths.service';
import { GbfsClient } from './gbfs/gbfs.client';
import { OtpClient } from './otp/otp.client';
import { SharedMobilityService } from './shared-mobility.service';
import { TransitService } from './transit.service';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

/**
 * Module des sources de données transport : GTFS (transports en commun, F3),
 * GBFS (vélos/trottinettes en libre-service, F3) et les aménagements cyclables
 * de PostGIS (UF-304) — trois formats standards (C9).
 *
 * `TransitService`, `SharedMobilityService` et `CyclePathsService` sont exportés :
 * ce sont les **trois** sources que le Service Itinéraire (module `routes`)
 * appellera en parallèle pour construire des itinéraires multimodaux (UF-305,
 * étape 4 du flux de référence).
 *
 * Les deux premières lisent des flux externes, la troisième notre propre base —
 * la différence est assumée : le réseau cyclable est du patrimoine, pas du temps
 * réel, et l'héberger retire une latence et un point de panne du chemin critique.
 *
 * `OtpClient` et `GbfsClient` restent internes au module : ni le protocole du
 * moteur de routage ni la structure des flux GBFS ne doivent fuiter ailleurs.
 */
@Module({
  controllers: [TransportController],
  providers: [
    CyclePathsService,
    GbfsClient,
    OtpClient,
    SharedMobilityService,
    TransitService,
    TransportService,
  ],
  exports: [CyclePathsService, SharedMobilityService, TransitService, TransportService],
})
export class TransportModule {}
