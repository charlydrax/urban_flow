import { Module } from '@nestjs/common';

import { CarbonController } from './carbon.controller';
import { CarbonService } from './carbon.service';

/**
 * Module carbone (fonctionnalité au choix retenue) — « Service Carbone » de
 * l'architecture logique : empreinte CO₂ par segment + tableau de bord personnel.
 */
@Module({
  controllers: [CarbonController],
  providers: [CarbonService],
  exports: [CarbonService],
})
export class CarbonModule {}
