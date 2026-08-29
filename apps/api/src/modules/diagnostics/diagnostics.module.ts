import { Module } from '@nestjs/common';

import { DiagnosticsController } from './diagnostics.controller';

/**
 * Module de diagnostic (UF-607) : point d'entrée des erreurs remontées par la
 * PWA. Sans service ni dépendance — il journalise, il ne persiste rien.
 */
@Module({
  controllers: [DiagnosticsController],
})
export class DiagnosticsModule {}
