import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { COMPRESSION_THRESHOLD_BYTES, shouldCompress } from './common/compression';
import { requestIdMiddleware } from './common/logging/request-id.middleware';
import { createAppLogger } from './common/logging/structured-logger';

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
 * - C4 (UF-604) : CSP explicite, et confiance au reverse proxy déclarée pour que
 *   la limitation de débit compte les vraies IP clientes.
 * - C5/C10 (UF-605) : compression des réponses JSON — 85 % de trafic en moins
 *   sur `/routes/plan`, hors chemins portant un secret (voir common/compression.ts).
 * - C11 (UF-607) : journalisation structurée hors développement et identifiant
 *   de corrélation par requête — de quoi enquêter sur un bogue de
 *   préproduction sans jamais journaliser de donnée personnelle.
 */
async function bootstrap(): Promise<void> {
  // Typé `NestExpressApplication` : `app.set('trust proxy', …)` plus bas est une
  // API Express, invisible sur l'interface générique `INestApplication`.
  //
  // `logger` est fourni dès la création (UF-607) : les messages de démarrage de
  // NestJS eux-mêmes doivent sortir au format de l'environnement, sinon les
  // premières lignes du conteneur — celles qui disent pourquoi il refuse de
  // démarrer — échappent au flux structuré.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: createAppLogger(),
  });
  const config = app.get(ConfigService);
  const isProduction = process.env.NODE_ENV === 'production';

  app.setGlobalPrefix('api');

  /*
   * Confiance au reverse proxy (UF-604 — C4).
   *
   * Express ne lit `X-Forwarded-For` que si on l'y autorise. Deux erreurs
   * symétriques, toutes deux graves :
   *  - ne pas faire confiance alors qu'on est derrière un proxy : toutes les
   *    requêtes portent l'IP du proxy, elles partagent donc UN SEUL compteur de
   *    débit — le premier utilisateur venu épuise le quota de tout le monde ;
   *  - faire confiance alors qu'on est exposé en direct : n'importe qui forge
   *    un `X-Forwarded-For` et se rend anonyme, le plafond anti-brute-force ne
   *    vaut plus rien.
   * D'où un réglage explicite de déploiement, jamais deviné : `TRUST_PROXY=1`
   * (nombre de proxys de confiance) uniquement quand il y en a vraiment un.
   */
  const trustedProxies = config.get<number>('TRUST_PROXY') ?? 0;
  if (trustedProxies > 0) {
    app.set('trust proxy', trustedProxies);
  }

  /*
   * Identifiant de corrélation (UF-607) — enregistré en TÊTE de chaîne.
   *
   * Tout ce qui suit journalise : helmet peut refuser une requête, le guard de
   * débit peut la couper, le filtre d'exceptions la conclut. Pour que ces
   * lignes portent toutes le même identifiant, le contexte doit être ouvert
   * avant elles. Voir common/logging/request-id.middleware.ts.
   */
  app.use(requestIdMiddleware);

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

      /*
       * Content-Security-Policy (UF-604 — C4 / OWASP A05 « Security
       * Misconfiguration »).
       *
       * L'API ne sert que du JSON : elle n'a besoin d'exécuter aucun script,
       * de charger aucune feuille de style, d'être incluse dans aucune iframe.
       * Une CSP « tout interdit sauf soi-même » ne coûte donc rien ici, et
       * transforme une éventuelle réflexion de contenu (un message d'erreur
       * renvoyant une entrée utilisateur, une réponse servie en `text/html`
       * par accident) en page inerte plutôt qu'en XSS.
       *
       * `frameAncestors: 'none'` couvre le clickjacking sur toutes les
       * réponses — y compris la documentation Swagger, qu'il serait sinon
       * possible d'encadrer dans un site tiers.
       *
       * `upgradeInsecureRequests` est retiré hors production : la directive
       * réécrirait en `https://` les requêtes du développement local, qui
       * tourne en HTTP. En production, HSTS et cette directive se complètent.
       */
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },

      /*
       * `Referrer-Policy: no-referrer` (défaut helmet, écrit noir sur blanc).
       * Les URL de l'API portent des identifiants de ressources ; aucune ne
       * doit fuiter dans l'en-tête `Referer` d'un site tiers (C11).
       */
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  /*
   * Exception de CSP réservée à la documentation Swagger.
   *
   * `/api/docs` est la SEULE réponse HTML de l'API, et Swagger UI s'initialise
   * par un script inline : sous la CSP stricte ci-dessus, la page reste
   * blanche. Plutôt que d'affaiblir la politique de toute l'API pour une page
   * d'outillage, l'assouplissement est limité à ce chemin — et il est
   * délibérément minimal (`'unsafe-inline'`, pas `'unsafe-eval'`, pas
   * d'origine externe : les assets de Swagger UI sont servis par l'API
   * elle-même).
   *
   * Ce middleware est enregistré APRÈS le helmet global : le dernier à écrire
   * l'en-tête gagne. Voir docs/securite-owasp.md (A05).
   */
  app.use(
    '/api/docs',
    helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    }),
  );
  /*
   * Compression des réponses (UF-605 — C5 éco-conception, C10 performances).
   *
   * Enregistrée AVANT tout ce qui écrit un corps, et après helmet : le
   * middleware doit envelopper `res.write`/`res.end` des couches situées en
   * dessous de lui pour avoir quoi comprimer.
   *
   * Le « pourquoi » (gain mesuré, exclusion BREACH des réponses porteuses de
   * jeton, seuil de 1 Ko) est documenté dans `common/compression.ts` — ici on
   * ne fait que le brancher.
   */
  app.use(
    compression({
      threshold: COMPRESSION_THRESHOLD_BYTES,
      filter: (req, res) => shouldCompress(req, res, compression.filter),
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
