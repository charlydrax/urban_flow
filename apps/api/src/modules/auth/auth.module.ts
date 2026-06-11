import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { JwtStrategy } from '../../common/strategies/jwt.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Module d'authentification (F1).
 * Fournit l'inscription, la connexion et la stratégie de vérification JWT
 * utilisée par le guard global de l'API Gateway (C4).
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      // Secret et durée de vie chargés depuis .env, jamais en dur (C4/C11)
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // Cast : la valeur .env est validée au boot (env.validation.ts) ; le type
        // attendu par jsonwebtoken est `StringValue` ("15m", "1h"...), pas string
        signOptions: {
          expiresIn: config.getOrThrow<string>('JWT_EXPIRES_IN') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
