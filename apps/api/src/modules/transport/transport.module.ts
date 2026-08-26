import { Module } from '@nestjs/common';

import { OtpClient } from './otp/otp.client';
import { TransitService } from './transit.service';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

/**
 * Module d'intégration des APIs de transport (F3) : GTFS (transports en commun)
 * et GBFS (vélos/trottinettes en libre-service) — formats standards (C9).
 *
 * `TransitService` est exporté : c'est lui que le Service Itinéraire (module
 * `routes`) appellera en parallèle des autres sources (UF-305). `OtpClient`
 * reste interne au module — le protocole du moteur de routage ne doit fuiter
 * nulle part ailleurs.
 */
@Module({
  controllers: [TransportController],
  providers: [OtpClient, TransitService, TransportService],
  exports: [TransitService, TransportService],
})
export class TransportModule {}
