import { runWithRequestContext } from './request-context';
import { StructuredLogger, type StructuredLogEntry } from './structured-logger';

/**
 * Tests de la journalisation structurée (UF-607).
 *
 * Ce qu'ils protègent, au-delà du format : un journal ne se relit que le jour
 * d'un incident, et c'est le pire moment pour découvrir qu'il ne dit rien. Les
 * cas figés ici sont donc ceux dont dépend l'enquête — la corrélation par
 * requête, la séparation stdout/stderr, l'absence de fausse ligne — et la
 * règle C11 : aucune donnée personnelle n'entre dans une ligne.
 */
describe('StructuredLogger — UF-607', () => {
  /** Capture les lignes écrites, en gardant le flux de destination. */
  function createLogger(level?: 'log' | 'debug'): {
    logger: StructuredLogger;
    lines: { stream: string; entry: StructuredLogEntry }[];
  } {
    const lines: { stream: string; entry: StructuredLogEntry }[] = [];
    const logger = new StructuredLogger(
      'urbanflow-api',
      'preproduction',
      level ?? 'log',
      (stream, line) => {
        lines.push({ stream, entry: JSON.parse(line) as StructuredLogEntry });
      },
    );
    return { logger, lines };
  }

  it('emits one JSON object per line with the service and environment stamped', () => {
    const { logger, lines } = createLogger();

    logger.log('plan computed in 812ms', 'RoutesService');

    expect(lines).toHaveLength(1);
    expect(lines[0].entry).toMatchObject({
      level: 'log',
      msg: 'plan computed in 812ms',
      context: 'RoutesService',
      service: 'urbanflow-api',
      env: 'preproduction',
    });
    // Horodatage exploitable par un agrégateur (tri, fenêtre temporelle).
    expect(new Date(lines[0].entry.ts).toISOString()).toBe(lines[0].entry.ts);
  });

  it('carries the request id of the ongoing request, and omits it outside one', () => {
    const { logger, lines } = createLogger();

    runWithRequestContext({ requestId: 'req-42' }, () => {
      logger.warn('GET /api/users/me -> 401', 'GlobalExceptionFilter');
    });
    logger.log('scheduled retention purge done', 'DataRetentionService');

    expect(lines[0].entry.requestId).toBe('req-42');
    // Hors requête (tâche planifiée, démarrage) : le champ disparaît, il n'est
    // pas rempli d'une valeur bidon qui ferait croire à une corrélation.
    expect(lines[1].entry.requestId).toBeUndefined();
  });

  it('routes errors to stderr with their stack, and the rest to stdout', () => {
    const { logger, lines } = createLogger();

    logger.error('POST /api/routes/plan -> 500', 'Error: boom\n    at plan()', 'RoutesService');
    logger.log('nominal', 'AppController');

    expect(lines[0].stream).toBe('stderr');
    expect(lines[0].entry.context).toBe('RoutesService');
    expect(lines[0].entry.stack).toContain('Error: boom');
    expect(lines[1].stream).toBe('stdout');
  });

  it('reads a single extra argument as the context, never as a stack', () => {
    const { logger, lines } = createLogger();

    logger.error('database unreachable', 'PrismaService');

    expect(lines[0].entry.context).toBe('PrismaService');
    expect(lines[0].entry.stack).toBeUndefined();
  });

  it('escapes newlines so a message cannot forge a second log line (OWASP A09)', () => {
    const { logger, lines } = createLogger();

    logger.warn('login failed\n{"level":"log","msg":"nothing to see here"}', 'AuthService');

    // Une seule ligne écrite, et le retour chariot est neutralisé dans le message.
    expect(lines).toHaveLength(1);
    expect(lines[0].entry.msg).not.toContain('\n');
    expect(lines[0].entry.msg).toContain('\\n');
  });

  it('truncates oversized messages instead of dumping a payload into the log', () => {
    const { logger, lines } = createLogger();

    logger.log('x'.repeat(5000), 'RoutesService');

    expect(lines[0].entry.msg.length).toBeLessThan(2100);
    expect(lines[0].entry.msg.endsWith('[tronqué]')).toBe(true);
  });

  it('drops levels below the configured verbosity (no debug noise in preprod)', () => {
    const { logger, lines } = createLogger('log');

    logger.debug('cache hit', 'GbfsClient');
    logger.verbose('parsing feed', 'GbfsClient');
    logger.warn('feed unavailable', 'GbfsClient');

    expect(lines.map((line) => line.entry.level)).toEqual(['warn']);
  });
});
