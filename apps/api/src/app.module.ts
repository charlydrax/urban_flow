import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { THROTTLER_OPTIONS } from './common/throttling';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { CarbonModule } from './modules/carbon/carbon.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { RoutesModule } from './modules/routes/routes.module';
import { SearchHistoryModule } from './modules/search-history/search-history.module';
import { TransportModule } from './modules/transport/transport.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Module racine de l'API Gateway (monolithe modulaire — cf. CLAUDE.md section 2).
 *
 * - Le guard JWT est appliqué GLOBALEMENT : tout endpoint est protégé par défaut,
 *   sauf opt-out explicite via `@Public()` (sécurité par défaut — C4).
 * - Le filtre d'exceptions global normalise les erreurs et journalise sans
 *   données personnelles (C11).
 * - La configuration est chargée depuis .env et validée au démarrage : l'API
 *   refuse de démarrer si une variable obligatoire manque (fail-fast, C4).
 * - Le guard de limitation de débit est déclaré **avant** le guard JWT : une
 *   rafale de requêtes anonymes doit être coupée au plus tôt, sans payer la
 *   vérification de signature ni la moindre requête en base (UF-604 — C4).
 * - `ScheduleModule` alimente la purge de rétention d'UF-603 : c'est la seule
 *   tâche périodique de l'API, et elle existe parce que la limitation de la
 *   conservation (C8) ne peut pas dépendre d'une action de l'utilisateur.
 * - `DiagnosticsModule` (UF-607) recueille les erreurs survenues dans le
 *   navigateur : sans lui, une panne d'affichage ne laisse aucune trace côté
 *   serveur, puisque la requête, elle, a réussi.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    // C4 (UF-604) : plafonds de requêtes par IP — voir common/throttling.ts.
    ThrottlerModule.forRoot(THROTTLER_OPTIONS),
    PrismaModule,
    AuthModule,
    UsersModule,
    RoutesModule,
    SearchHistoryModule,
    TransportModule,
    CarbonModule,
    PrivacyModule,
    DiagnosticsModule,
  ],
  controllers: [AppController],
  providers: [
    // L'ordre compte : les guards globaux s'exécutent dans l'ordre de déclaration.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
