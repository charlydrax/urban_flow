import { describe, expect, it } from 'vitest';

import {
  buildLoginUrl,
  isPublicPath,
  readSession,
  readTokenClaims,
  sanitizeNextPath,
} from './session';

/**
 * Tests des primitives de session du front (UF-106).
 *
 * Deux comportements y sont figés parce qu'une régression y serait invisible à
 * l'œil nu mais grave :
 *  - une session expirée doit être vue comme absente (sinon on affiche une page
 *    privée que l'API refusera de remplir) ;
 *  - `sanitizeNextPath` doit rejeter toute destination externe, sous peine de
 *    transformer l'écran de connexion en tremplin de phishing (OWASP A01 — C4).
 */

/** Fabrique un JWT de test : seule la charge utile compte (signature non vérifiée côté front). */
function makeToken(claims: Record<string, unknown>): string {
  const base64url = (value: object) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(claims)}.signature-non-verifiee`;
}

const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);
const USER = { sub: '11111111-1111-4111-8111-111111111111', email: 'marie@example.com' };

describe('readTokenClaims', () => {
  it('reads the claims of a well-formed token', () => {
    const claims = readTokenClaims(makeToken({ ...USER, exp: 1_800_000_000 }));

    expect(claims).toEqual({ ...USER, exp: 1_800_000_000 });
  });

  it('decodes non-ASCII emails (UTF-8, not latin1)', () => {
    const claims = readTokenClaims(makeToken({ ...USER, email: 'clémentine@exemple.fr', exp: 1 }));

    expect(claims?.email).toBe('clémentine@exemple.fr');
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['not a JWT', 'pas-un-jwt'],
    ['payload is not base64', 'a.!!!.c'],
    ['payload without sub/email', makeToken({ foo: 'bar' })],
  ])('returns null when the token is %s', (_label, token) => {
    expect(readTokenClaims(token)).toBeNull();
  });
});

describe('readSession', () => {
  it('returns the user while the token is still valid', () => {
    const token = makeToken({ ...USER, exp: NOW / 1000 + 60 });

    expect(readSession(token, NOW)).toEqual({ id: USER.sub, email: USER.email });
  });

  it('returns null once the token is expired (the API would answer 401)', () => {
    const token = makeToken({ ...USER, exp: NOW / 1000 - 1 });

    expect(readSession(token, NOW)).toBeNull();
  });

  it('treats `exp` as seconds: a token valid for one more minute is not expired', () => {
    // Régression visée : comparer `exp` (secondes) à `Date.now()` (millisecondes)
    // sans convertir ferait passer TOUTE session pour expirée.
    const token = makeToken({ ...USER, exp: NOW / 1000 + 60 });

    expect(readSession(token, NOW)).not.toBeNull();
  });

  it('expires exactly at `exp` (no grace period)', () => {
    const token = makeToken({ ...USER, exp: NOW / 1000 });

    expect(readSession(token, NOW)).toBeNull();
  });

  it('returns null when the token carries no expiry', () => {
    expect(readSession(makeToken(USER), NOW)).toBeNull();
  });
});

describe('sanitizeNextPath', () => {
  it('keeps an internal path with its query string', () => {
    expect(sanitizeNextPath('/?from=Part-Dieu&to=Bellecour')).toBe('/?from=Part-Dieu&to=Bellecour');
  });

  it.each([
    ['absolute URL', 'https://evil.tld/phishing'],
    ['protocol-relative URL', '//evil.tld'],
    ['backslash trick', '/\\evil.tld'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['relative path', 'dashboard'],
    ['empty', ''],
  ])('rejects an external or malformed destination (%s)', (_label, raw) => {
    expect(sanitizeNextPath(raw)).toBeNull();
  });

  it('rejects public screens to avoid a login → login loop', () => {
    expect(sanitizeNextPath('/login')).toBeNull();
    expect(sanitizeNextPath('/register')).toBeNull();
  });
});

describe('isPublicPath', () => {
  it('marks the auth screens as public', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/register')).toBe(true);
  });

  it('marks everything else as private by default', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/carbon')).toBe(false);
    // Piège classique : un préfixe ne suffit pas à rendre une route publique.
    expect(isPublicPath('/login-history')).toBe(false);
  });
});

describe('buildLoginUrl', () => {
  it('remembers the requested page and the reason', () => {
    const url = new URL(buildLoginUrl('/?from=A', 'session-expired'), 'http://localhost');

    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe('/?from=A');
    expect(url.searchParams.get('reason')).toBe('session-expired');
  });

  it('omits `next` when the destination is not safe to keep', () => {
    const url = new URL(buildLoginUrl('https://evil.tld'), 'http://localhost');

    expect(url.searchParams.has('next')).toBe(false);
    expect(url.searchParams.get('reason')).toBe('auth-required');
  });
});
