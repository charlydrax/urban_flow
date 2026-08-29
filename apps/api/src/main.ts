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
 * - C8/C11 (UF-603) : HSTS explicite — les données de déplacement ne circulent
 *   qu'en HTTPS, y compris à la toute première requête.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.use(
    helmet({
      /*
       * HSTS (RGPD art. 32 « chiffrement en transit » — C8/C11, recette 4
       * d'UF-603). Helmet l'active par défaut ; il est écrit explicitement ici
       * parce que la valeur par défaut d'une dépendance n'est pas une décision
       * traçable, et que ce header est justement celui qu'un audit RGPD
       * cherche.
       *
       * Ce qu'il apporte concrètement : une fois l'en-tête reçu, le navigateur
       * refuse de rappeler ce domaine en HTTP, même si l'utilisateur tape
       * l'adresse à la main ou suit un vieux lien. Sans lui, la toute première
       * requête d'une session — celle qui porte le cookie de session — peut
       * partir en clair et être interceptée avant même la redirection 301.
       *
       * `maxAge` à 6 mois : la durée recommandée par l'ANSSI et l'OWASP. Plus
       * court affaiblit la protection, plus long piège le domaine si le projet
       * devait un jour repasser en HTTP.
       *
       * `includeSubDomains` : le front, l'API et un éventuel sous-domaine de
       * tuiles partagent le même cookie de session — protéger le seul domaine
       * apex laisserait la porte ouverte à côté.
       */
      hsts: { maxAge: 15_552_000, includeSubDomains: true, preload: false },
    }),
  );
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
