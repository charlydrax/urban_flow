import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';

/**
 * Bootstrap de l'API Gateway UrbanFlow.
 *
 * Couvre :
 * - C4 (OWASP) : helmet (en-têtes sécurité), ValidationPipe global strict
 *   (whitelist + forbidNonWhitelisted = toute entrée non déclarée est rejetée),
 *   CORS restreint à l'origine du front.
 * - C9 (interopérabilité) : documentation OpenAPI/Swagger exposée sur /api/docs.
 * - C11 (sécurité données) : cookie-parser pour lire le JWT depuis un cookie httpOnly.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    // C4 : seule l'origine du client PWA est autorisée (pas de wildcard)
    origin: config.getOrThrow<string>('CORS_ORIGIN'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // C9 : contrat d'API documenté et explorable (Swagger UI)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('UrbanFlow Mobility API')
    .setDescription(
      'API Gateway du MVP UrbanFlow : authentification (F1), planificateur multimodal (F2), ' +
        'intégrations transport GTFS/GBFS (F3) et calculateur carbone.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addCookieAuth('access_token')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
}

void bootstrap();
