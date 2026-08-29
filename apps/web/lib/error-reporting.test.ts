import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildClientErrorReport,
  getLastApiRequestId,
  recordApiRequestId,
  reportClientError,
  screenFromPathname,
} from './error-reporting';

/**
 * Tests du signalement d'erreurs front (UF-607).
 *
 * Deux exigences y sont figées, et la seconde est la plus importante :
 *  - le signalement **part** et porte de quoi retrouver la trace serveur ;
 *  - il ne contient **aucune donnée personnelle** (C8/C11). Cette règle-là ne
 *    se vérifie pas à la relecture : elle se casse le jour où quelqu'un ajoute
 *    « juste l'URL complète » pour se faciliter le diagnostic.
 */
describe('screenFromPathname', () => {
  it.each([
    ['/', 'planner'],
    ['/login', 'login'],
    ['/register', 'register'],
    ['/profil', 'profile'],
    ['/impact', 'impact'],
    ['/confidentialite', 'privacy'],
    ['/impact/', 'impact'],
  ])('associe %s à l’écran %s', (pathname, expected) => {
    expect(screenFromPathname(pathname)).toBe(expected);
  });

  it('retombe sur « unknown » pour un chemin inconnu ou absent', () => {
    expect(screenFromPathname('/une/page/inexistante')).toBe('unknown');
    expect(screenFromPathname(undefined)).toBe('unknown');
  });
});

describe('buildClientErrorReport', () => {
  it('retient le message, le nom de l’erreur et l’écran', () => {
    const report = buildClientErrorReport(new TypeError('segments is undefined'), '/');

    expect(report).toMatchObject({
      message: 'segments is undefined',
      name: 'TypeError',
      screen: 'planner',
    });
  });

  it('n’emporte ni URL complète, ni paramètres de recherche (C8/C11)', () => {
    const report = buildClientErrorReport(
      new Error('render failed'),
      '/?from=12+rue+de+la+Paix&to=Bellecour',
    );

    // Le chemin porteur d'adresses n'est pas reconnu : il devient « unknown »,
    // et aucun champ du signalement ne contient la chaîne de requête.
    expect(report.screen).toBe('unknown');
    expect(JSON.stringify(report)).not.toContain('rue de la Paix');
    expect(JSON.stringify(report)).not.toContain('from=');
  });

  it('borne le message à ce que l’API accepte, au lieu de se faire rejeter', () => {
    const report = buildClientErrorReport(new Error('x'.repeat(1000)), '/');

    expect(report.message).toHaveLength(300);
  });

  it('remplace un message vide par un libellé valide', () => {
    const report = buildClientErrorReport(new Error('   '), '/');

    expect(report.message).toBe('Unknown error');
  });

  it('reprend le digest d’une erreur de rendu serveur Next.js', () => {
    const error = Object.assign(new Error('server render failed'), { digest: '1873452901' });

    expect(buildClientErrorReport(error, '/impact').digest).toBe('1873452901');
  });

  it('joint l’identifiant du dernier appel d’API, pour corréler les journaux', () => {
    recordApiRequestId(new Headers({ 'x-request-id': 'req-abc-123' }));

    expect(getLastApiRequestId()).toBe('req-abc-123');
    expect(buildClientErrorReport(new Error('boom'), '/').requestId).toBe('req-abc-123');
  });
});

describe('reportClientError', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    // L'environnement de la suite unitaire est `node` : on simule la présence
    // d'un navigateur, seule condition à laquelle le signalement part.
    vi.stubGlobal('window', {});
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('poste le signalement en keepalive et sans cookie de session', () => {
    reportClientError(new Error('boom'), '/login');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/diagnostics/client-errors');
    expect(init.keepalive).toBe(true);
    // Aucune identité transmise : l'endpoint est ouvert et n'a pas à savoir qui
    // signale (C8 — minimisation).
    expect(init.credentials).toBeUndefined();
    expect(JSON.parse(String(init.body))).toMatchObject({ screen: 'login', message: 'boom' });
  });

  it('n’échoue jamais, même si le réseau refuse le signalement (C10)', () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('offline')));

    expect(() => reportClientError(new Error('boom'), '/')).not.toThrow();
  });

  it('ne tente rien côté serveur, où il n’y a pas d’usager devant l’écran', () => {
    vi.stubGlobal('window', undefined);

    reportClientError(new Error('boom'), '/');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
