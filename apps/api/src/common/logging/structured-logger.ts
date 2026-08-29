import { ConsoleLogger, LogLevel, LoggerService } from '@nestjs/common';

import { getRequestId } from './request-context';

/** Niveaux de journalisation NestJS, du plus grave au plus bavard. */
const LEVEL_ORDER: readonly LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

/**
 * Longueur maximale d'un message journalisé.
 *
 * Un message n'est pas une charge utile : une trace de 200 Ko dans une ligne
 * JSON sature le disque du serveur de préproduction en quelques rafales, et
 * rend le fichier illisible pour l'humain qui enquête. Ce qui déborde est
 * tronqué, jamais silencieusement supprimé (le suffixe le dit).
 */
const MAX_MESSAGE_LENGTH = 2000;

/** Ligne de journal émise par {@link StructuredLogger} — un objet JSON par ligne. */
export interface StructuredLogEntry {
  /** Horodatage ISO 8601 UTC. */
  ts: string;
  /** Niveau NestJS (`error`, `warn`, `log`, …). */
  level: LogLevel;
  /** Message, nettoyé et borné. */
  msg: string;
  /** Composant émetteur (`RoutesService`, `GlobalExceptionFilter`, …). */
  context?: string;
  /** Identifiant de corrélation de la requête en cours, quand il y en a une. */
  requestId?: string;
  /** Nom du service — utile dès qu'un agrégateur reçoit plusieurs sources. */
  service: string;
  /** Environnement de déploiement (`development`, `preproduction`, `production`). */
  env: string;
  /** Pile d'appel, uniquement sur les niveaux `error` et `fatal`. */
  stack?: string;
}

/**
 * Neutralise ce qui rendrait une ligne de journal trompeuse ou ingérable.
 *
 * Les sauts de ligne sont échappés : un message qui en contient fabriquerait
 * sinon une **fausse ligne de journal** dans un flux « un objet JSON par
 * ligne » — c'est l'injection de journaux d'OWASP A09, et elle sert
 * précisément à noyer une trace gênante au milieu du bruit.
 */
function sanitizeMessage(value: unknown): string {
  const raw =
    typeof value === 'string'
      ? value
      : value instanceof Error
        ? value.message
        : (() => {
            try {
              return JSON.stringify(value) ?? String(value);
            } catch {
              // Références circulaires : mieux vaut une ligne pauvre qu'une
              // journalisation qui lève une exception dans le gestionnaire d'erreurs.
              return String(value);
            }
          })();

  const escaped = raw.replace(/[\r\n]+/g, '\\n');
  return escaped.length > MAX_MESSAGE_LENGTH
    ? `${escaped.slice(0, MAX_MESSAGE_LENGTH)}… [tronqué]`
    : escaped;
}

/**
 * Journalisation structurée de l'API Gateway (UF-607).
 *
 * **Pourquoi du JSON.** Le format lisible de NestJS convient à un développeur
 * qui regarde son terminal ; il ne convient pas à une préproduction, où l'on
 * cherche « toutes les erreurs 500 de la dernière heure » ou « la trace de la
 * requête `a1b2c3` signalée par un testeur ». Une ligne = un objet JSON se
 * filtre avec `jq`, se recherche par champ, et s'ingère telle quelle par un
 * agrégateur le jour où le projet en aura un — sans réécrire une seule ligne
 * d'appel : tous les `Logger` existants passent par ici.
 *
 * **Ce qui n'y entre jamais** (C11 / RGPD) : le corps des requêtes, les
 * coordonnées de départ et d'arrivée, l'e-mail, le jeton. Les appelants
 * journalisent des faits techniques (méthode, chemin, statut, durée) ; la
 * corrélation avec une personne passe par un identifiant de requête éphémère,
 * jamais par une donnée d'identité.
 *
 * Le flux de sortie suit la convention Unix : `stderr` pour `error`/`fatal`,
 * `stdout` pour le reste — un orchestrateur (Docker, systemd) les sépare ainsi
 * sans configuration.
 */
export class StructuredLogger implements LoggerService {
  private readonly enabledLevels: Set<LogLevel>;

  /**
   * @param service Nom du service inscrit dans chaque ligne
   * @param env Environnement de déploiement inscrit dans chaque ligne
   * @param level Niveau le plus bavard à émettre (les plus graves passent toujours)
   * @param write Écriture effective — injectable pour les tests
   */
  constructor(
    private readonly service: string,
    private readonly env: string,
    level: LogLevel = 'log',
    private readonly write: (stream: 'stdout' | 'stderr', line: string) => void = (
      stream,
      line,
    ) => {
      process[stream].write(`${line}\n`);
    },
  ) {
    const cutoff = LEVEL_ORDER.indexOf(level);
    this.enabledLevels = new Set(LEVEL_ORDER.slice(0, cutoff === -1 ? 4 : cutoff + 1));
  }

  /** Journalise un événement nominal (`log` au sens NestJS = niveau « info »). */
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('log', message, optionalParams);
  }

  /** Journalise une erreur : la pile est conservée dans un champ dédié. */
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('error', message, optionalParams);
  }

  /** Journalise un avertissement (erreur métier attendue, source dégradée…). */
  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', message, optionalParams);
  }

  /** Journalise une information de mise au point (coupée hors développement). */
  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', message, optionalParams);
  }

  /** Journalise une trace très fine (coupée hors développement). */
  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('verbose', message, optionalParams);
  }

  /** Journalise une erreur fatale au démarrage ou à l'arrêt du processus. */
  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('fatal', message, optionalParams);
  }

  /**
   * Construit la ligne JSON.
   *
   * NestJS appelle ses loggers avec une convention positionnelle non typée :
   * `logger.error(message, stack, context)` et `logger.log(message, context)`.
   * On la décode ici plutôt que d'imposer une API maison, pour que le code
   * existant (`new Logger(X.name)` partout) gagne la journalisation structurée
   * sans être touché.
   */
  private emit(level: LogLevel, message: unknown, optionalParams: unknown[]): void {
    if (!this.enabledLevels.has(level)) return;

    const params = optionalParams.filter((param) => typeof param === 'string');
    const isErrorLevel = level === 'error' || level === 'fatal';
    // `error(message, stack, context)` : la pile précède le contexte, mais elle
    // est facultative — un appel à un seul argument supplémentaire porte donc
    // le contexte, pas la trace.
    const stack = isErrorLevel && params.length > 1 ? params[0] : undefined;
    const context = params.length > 0 ? params[params.length - 1] : undefined;

    const entry: StructuredLogEntry = {
      ts: new Date().toISOString(),
      level,
      msg: sanitizeMessage(message),
      service: this.service,
      env: this.env,
    };
    if (context !== undefined) entry.context = context;
    const requestId = getRequestId();
    if (requestId !== undefined) entry.requestId = requestId;
    if (stack !== undefined) entry.stack = sanitizeMessage(stack);

    this.write(isErrorLevel ? 'stderr' : 'stdout', JSON.stringify(entry));
  }
}

/**
 * Choisit le journal adapté à l'environnement (UF-607).
 *
 * En développement, le format coloré de NestJS reste le plus lisible dans un
 * terminal : imposer du JSON à tout le monde ferait perdre plus de confort
 * qu'il n'apporte de traçabilité sur un poste. Partout ailleurs — et en
 * particulier en préproduction, où l'on chasse les bogues avant la mise en
 * production — c'est le format structuré qui sert.
 *
 * `LOG_FORMAT` permet de forcer l'un ou l'autre : `LOG_FORMAT=json npm run
 * dev:api` reproduit en local exactement ce que la préproduction écrira.
 *
 * Lit `process.env` directement, et non `ConfigService` : le logger est passé à
 * `NestFactory.create()`, donc construit **avant** que le conteneur
 * d'injection n'existe.
 *
 * @returns Le service de journalisation à passer à `NestFactory.create()`
 */
export function createAppLogger(): LoggerService {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  const format = process.env.LOG_FORMAT ?? (env === 'development' ? 'pretty' : 'json');
  const level: LogLevel = env === 'development' ? 'debug' : 'log';

  if (format === 'pretty') {
    return new ConsoleLogger({ logLevels: LEVEL_ORDER.slice(0, LEVEL_ORDER.indexOf(level) + 1) });
  }
  return new StructuredLogger('urbanflow-api', env, level);
}
