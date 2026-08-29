import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { CarbonModule } from './modules/carbon/carbon.module';
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
 * - `ScheduleModule` alimente la purge de rétention d'UF-603 : c'est la seule
 *   tâche périodique de l'API, et elle existe parce que la limitation de la
 *   conservation (C8) ne peut pas dépendre d'une action de l'utilisateur.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    RoutesModule,
    SearchHistoryModule,
    TransportModule,
    CarbonModule,
    PrivacyModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
