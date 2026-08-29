import { describe, expect, it } from 'vitest';

import {
  buildContentSecurityPolicy,
  HSTS_HEADER,
  STATIC_SECURITY_HEADERS,
} from './security-headers';

/**
 * Recette 1 d'UF-604 : « les en-têtes de sécurité sont présents ».
 *
 * Ces tests figent la politique, pas la syntaxe : chacun correspond à une
 * attaque nommée dans la checklist `docs/securite-owasp.md`. Une directive
 * retirée par confort (« la carte ne s'affichait plus ») casse ici, avec le
 * nom de ce qu'elle protégeait.
 */

/** Découpe la CSP en `{ directive: [sources] }` pour l'interroger lisiblement. */
function parse(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(';').map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

const productionCsp = () =>
  parse(
    buildContentSecurityPolicy({
      nonce: 'test-nonce',
      isDev: false,
      apiUrl: 'https://api.urbanflow.example/api',
    }),
  );

describe('buildContentSecurityPolicy — anti-XSS (OWASP A03)', () => {
  it('autorise les scripts par nonce, et rien d’autre en production', () => {
    const csp = productionCsp();

    expect(csp['script-src']).toEqual(["'self'", "'nonce-test-nonce'"]);
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
  });

  it('n’ouvre `unsafe-eval` que sous next dev (rechargement à chaud)', () => {
    const dev = parse(buildContentSecurityPolicy({ nonce: 'n', isDev: true }));
    expect(dev['script-src']).toContain("'unsafe-eval'");
  });

  it('interdit l’encadrement de l’application (clickjacking)', () => {
    expect(productionCsp()['frame-ancestors']).toEqual(["'none'"]);
  });

  it('empêche un formulaire injecté de poster vers un serveur tiers', () => {
    const csp = productionCsp();
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
  });
});

describe('buildContentSecurityPolicy — destinations réseau (C8/C11)', () => {
  it('réduit l’URL de l’API à son origine, jamais son chemin', () => {
    // `https://api.urbanflow.example/api` décrit un chemin ; une source CSP
    // se raisonne par origine, sinon la directive ne couvre pas ce qu'on croit.
    expect(productionCsp()['connect-src']).toContain('https://api.urbanflow.example');
    expect(productionCsp()['connect-src']).not.toContain('https://api.urbanflow.example/api');
  });

  it('autorise le géocodage BAN, seul service tiers appelé par le navigateur', () => {
    expect(productionCsp()['connect-src']).toContain('https://api-adresse.data.gouv.fr');
  });

  it('ignore une URL d’API absente ou illisible plutôt que d’élargir la politique', () => {
    const csp = parse(
      buildContentSecurityPolicy({ nonce: 'n', isDev: false, apiUrl: 'pas-une-url' }),
    );

    expect(csp['connect-src']).toEqual([
      "'self'",
      'https://api-adresse.data.gouv.fr',
      'https://api.maptiler.com',
      'https://tile.openstreetmap.org',
    ]);
    expect(csp['connect-src']).not.toContain('*');
  });

  it('ajoute le style de carte auto-hébergé quand il est configuré', () => {
    const csp = parse(
      buildContentSecurityPolicy({
        nonce: 'n',
        isDev: false,
        mapStyleUrl: 'https://tuiles.grandlyon.fr/styles/base/style.json',
      }),
    );

    expect(csp['connect-src']).toContain('https://tuiles.grandlyon.fr');
    expect(csp['img-src']).toContain('https://tuiles.grandlyon.fr');
  });
});

describe('buildContentSecurityPolicy — compatibilité MapLibre (UF-201)', () => {
  it('autorise les workers blob, sans quoi la carte reste noire', () => {
    expect(productionCsp()['worker-src']).toEqual(["'self'", 'blob:']);
  });

  it('autorise les tuiles des deux fournisseurs possibles', () => {
    const imgSrc = productionCsp()['img-src'];
    expect(imgSrc).toContain('https://api.maptiler.com');
    expect(imgSrc).toContain('https://tile.openstreetmap.org');
    expect(imgSrc).toContain('blob:');
  });
});

describe('buildContentSecurityPolicy — transport', () => {
  it('force HTTPS en production seulement', () => {
    const prod = buildContentSecurityPolicy({ nonce: 'n', isDev: false });
    const dev = buildContentSecurityPolicy({ nonce: 'n', isDev: true });

    expect(prod).toContain('upgrade-insecure-requests');
    // En dev, la directive réécrirait http://localhost:3000 en https.
    expect(dev).not.toContain('upgrade-insecure-requests');
  });
});

describe('en-têtes constants (next.config.ts)', () => {
  const header = (key: string) => STATIC_SECURITY_HEADERS.find((h) => h.key === key)?.value;

  it('interdit la déduction de type MIME', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
  });

  it('double frame-ancestors pour les réponses hors middleware', () => {
    expect(header('X-Frame-Options')).toBe('DENY');
  });

  it('ne laisse pas fuiter une adresse de départ dans le Referer', () => {
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('réserve la géolocalisation à notre origine et coupe les autres capteurs', () => {
    const policy = header('Permissions-Policy') ?? '';

    expect(policy).toContain('geolocation=(self)');
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
  });

  it('garde HSTS hors des en-têtes constants (il est réservé à la production)', () => {
    expect(STATIC_SECURITY_HEADERS.map((h) => h.key)).not.toContain('Strict-Transport-Security');
    expect(HSTS_HEADER.value).toContain('max-age=15552000');
  });
});
