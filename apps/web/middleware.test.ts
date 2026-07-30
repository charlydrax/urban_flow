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
});
