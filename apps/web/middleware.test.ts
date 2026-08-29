import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from './middleware';

/**
 * Tests du middleware de protection des routes (UF-106).
 *
 * Ils figent la recette du ticket au niveau de la navigation :
 *  1. une page privée sans session renvoie vers /login ;
 *  2. un token expiré est traité comme une absence de session ;
 *  3. la page demandée est mémorisée pour y revenir après connexion.
 *
 * UF-603 y ajoute la politique de confidentialité, qui n'entre dans aucune des
 * deux cases habituelles : publique **sans** être un écran d'authentification.
 * C'est le cas que la version précédente du middleware traitait mal.
 */

/** Fabrique un JWT de test (charge utile seule : le front ne vérifie pas la signature). */
function makeToken(expiresInSeconds: number): string {
  const base64url = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const claims = {
    sub: '11111111-1111-4111-8111-111111111111',
    email: 'marie@example.com',
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(claims)}.signature`;
}

/** Requête de navigation vers `path`, avec ou sans cookie de session. */
function requestFor(path: string, token?: string): NextRequest {
  const request = new NextRequest(new URL(path, 'http://localhost:3000'));
  if (token) request.cookies.set('access_token', token);
  return request;
}

/** Emplacement d'une redirection, relatif à l'origine de test. */
function locationOf(response: Response): URL {
  return new URL(response.headers.get('location') ?? '', 'http://localhost:3000');
}

describe('middleware — protection des routes (UF-106)', () => {
  it('redirects to /login when a private page is requested without a session', () => {
    const response = middleware(requestFor('/'));

    expect(response.status).toBe(307);
    expect(locationOf(response).pathname).toBe('/login');
  });

  it('treats an expired token as no session at all', () => {
    const response = middleware(requestFor('/', makeToken(-60)));

    expect(locationOf(response).pathname).toBe('/login');
    expect(locationOf(response).searchParams.get('reason')).toBe('auth-required');
  });

  it('remembers the requested page, query string included', () => {
    const response = middleware(requestFor('/?from=Part-Dieu&to=Bellecour'));

    expect(locationOf(response).searchParams.get('next')).toBe('/?from=Part-Dieu&to=Bellecour');
  });

  it('lets a valid session reach the private page', () => {
    const response = middleware(requestFor('/', makeToken(900)));

    expect(response.headers.get('location')).toBeNull();
  });

  it('leaves the auth screens open to anonymous visitors', () => {
    expect(middleware(requestFor('/login')).headers.get('location')).toBeNull();
    expect(middleware(requestFor('/register')).headers.get('location')).toBeNull();
  });

  it('sends an already connected visitor away from /login', () => {
    const response = middleware(requestFor('/login', makeToken(900)));

    expect(locationOf(response).pathname).toBe('/');
  });

  describe('politique de confidentialité (UF-603)', () => {
    it('is readable without an account — the condition of informed consent', () => {
      expect(middleware(requestFor('/confidentialite')).headers.get('location')).toBeNull();
    });

    it('stays readable while signed in, unlike the auth screens', () => {
      // Le piège : traiter cette page comme /login éjecterait vers l'accueil
      // l'utilisateur connecté venu relire la durée de conservation de ses trajets.
      const response = middleware(requestFor('/confidentialite', makeToken(900)));

      expect(response.headers.get('location')).toBeNull();
    });
  });
});

/**
 * UF-604 — la CSP est posée par le middleware parce qu'elle porte un nonce par
 * requête. Ces tests vérifient qu'aucun chemin de sortie ne l'oublie : une
 * redirection sans CSP n'est pas un trou béant, mais la première réponse d'une
 * session en est souvent une, et une politique « presque partout » n'en est pas.
 */
describe('middleware — en-tête Content-Security-Policy (UF-604)', () => {
  const cspOf = (response: Response) => response.headers.get('content-security-policy') ?? '';

  it('pose la CSP sur une page rendue', () => {
    expect(cspOf(middleware(requestFor('/', makeToken(900))))).toContain("default-src 'self'");
  });

  it('la pose aussi sur la redirection vers /login', () => {
    expect(cspOf(middleware(requestFor('/')))).toContain("frame-ancestors 'none'");
  });

  it('la pose sur la redirection inverse (connecté arrivant sur /login)', () => {
    expect(cspOf(middleware(requestFor('/login', makeToken(900))))).toContain("script-src 'self'");
  });

  it('la pose sur une page publique comme la politique de confidentialité', () => {
    expect(cspOf(middleware(requestFor('/confidentialite')))).toContain("object-src 'none'");
  });

  it('tire un nonce neuf à chaque requête — le réutiliser reviendrait à le publier', () => {
    const first = cspOf(middleware(requestFor('/', makeToken(900))));
    const second = cspOf(middleware(requestFor('/', makeToken(900))));

    const nonceOf = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1];

    expect(nonceOf(first)).toBeDefined();
    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });
});
