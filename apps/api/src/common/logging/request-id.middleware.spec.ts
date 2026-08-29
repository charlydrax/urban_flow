import type { NextFunction, Request, Response } from 'express';

import { getRequestId } from './request-context';
import { REQUEST_ID_HEADER, requestIdMiddleware, resolveRequestId } from './request-id.middleware';

/**
 * Tests de l'identifiant de corrélation (UF-607).
 *
 * L'enjeu n'est pas cosmétique : cet identifiant est la clé de jointure entre
 * un signalement d'usager et la trace serveur (docs/bug-process.md). Il est
 * aussi une **entrée utilisateur** reprise dans les journaux — d'où les cas de
 * rejet, qui valent autant que le cas nominal.
 */
describe('requestIdMiddleware — UF-607', () => {
  /** Doublures minimales : le middleware ne touche qu'aux en-têtes. */
  function createExchange(incoming?: string): {
    request: Request;
    response: Response;
    headers: Record<string, string>;
  } {
    const headers: Record<string, string> = {};
    const request = {
      headers: incoming === undefined ? {} : { [REQUEST_ID_HEADER]: incoming },
    } as unknown as Request;
    const response = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response;
    return { request, response, headers };
  }

  const next: NextFunction = () => undefined;

  it('generates an id, returns it in the response header and exposes it to the loggers', () => {
    const { request, response, headers } = createExchange();
    let seenInsideRequest: string | undefined;

    requestIdMiddleware(request, response, () => {
      seenInsideRequest = getRequestId();
    });

    const generated = headers[REQUEST_ID_HEADER];
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    // Même valeur partout : en-tête de réponse, contexte de journalisation, et
    // en-tête de requête réécrit pour les couches suivantes.
    expect(seenInsideRequest).toBe(generated);
    expect(request.headers[REQUEST_ID_HEADER]).toBe(generated);
  });

  it('reuses the id provided by the client, so the PWA and the API share one key', () => {
    const { request, response, headers } = createExchange('5f1d1c0a-2a6e-4f3b-9a8f-2c1d3e4f5a6b');

    requestIdMiddleware(request, response, next);

    expect(headers[REQUEST_ID_HEADER]).toBe('5f1d1c0a-2a6e-4f3b-9a8f-2c1d3e4f5a6b');
  });

  it('does not leak the request context to the next request', () => {
    const first = createExchange();
    requestIdMiddleware(first.request, first.response, next);

    // En dehors de toute exécution sous contexte, plus rien n'est visible :
    // sans quoi une ligne de journal pourrait porter l'identifiant d'une
    // requête antérieure, et l'enquête suivrait une fausse piste.
    expect(getRequestId()).toBeUndefined();
  });

  describe('resolveRequestId — the header is untrusted input', () => {
    it.each([
      ['a newline that would forge a log line', 'abc\n{"level":"log"}'],
      ['a value longer than 64 characters', 'a'.repeat(65)],
      ['an empty value', ''],
      ['a value with spaces and quotes', 'req "42"'],
    ])('replaces %s with a generated uuid', (_case, candidate) => {
      expect(resolveRequestId(candidate)).not.toBe(candidate);
      expect(resolveRequestId(candidate)).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('keeps a plain trace identifier as-is', () => {
      expect(resolveRequestId('trace-01H8.beta:3')).toBe('trace-01H8.beta:3');
    });

    it('keeps only the first value when the header is repeated', () => {
      expect(resolveRequestId(['req-1', 'req-2'])).toBe('req-1');
    });
  });
});
