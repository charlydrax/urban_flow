/**
 * En-têtes de sécurité du client PWA (UF-604 — C4 / OWASP A05).
 *
 * Module **pur** : aucune dépendance à `next/server` ni à React, pour être
 * lisible par le middleware (runtime Edge), par `next.config.ts` (Node, au
 * démarrage) et par Vitest en environnement `node`.
 *
 * Répartition volontaire :
 * - les en-têtes **constants** partent de `next.config.ts`, donc sur *toutes*
 *   les réponses, y compris les fichiers statiques que le middleware ignore ;
 * - la **CSP** est posée par le middleware, parce qu'elle embarque un `nonce`
 *   régénéré à chaque requête et ne peut donc pas être statique.
 */

/** Origines contactées par le navigateur, extraites de l'environnement du build. */
export interface CspOrigins {
  /** `NEXT_PUBLIC_API_URL` — l'API Gateway, seule destination des appels métier. */
  apiUrl?: string;
  /** `NEXT_PUBLIC_MAP_STYLE_URL` — style MapLibre auto-hébergé, quand il est configuré. */
  mapStyleUrl?: string;
}

/** Paramètres de construction de la politique de sécurité de contenu. */
export interface CspOptions extends CspOrigins {
  /** Nonce autorisant les scripts inline légitimes de Next.js (hydratation). */
  nonce: string;
  /** `true` sous `next dev` : desserre le strict minimum pour le rechargement à chaud. */
  isDev: boolean;
}

/**
 * Adresse de l'API de géocodage (Base Adresse Nationale) appelée **depuis le
 * navigateur** — cf. `lib/geocoding.ts`. Elle est en dur ici comme là-bas :
 * c'est un service public identifié, pas un paramètre de déploiement.
 */
const BAN_ORIGIN = 'https://api-adresse.data.gouv.fr';

/**
 * Fournisseurs de tuiles possibles (UF-201) : MapTiler quand une clé est
 * configurée, OpenStreetMap en repli. Les deux servent des **images**, d'où
 * leur présence en `img-src` et non en `script-src`.
 */
const TILE_ORIGINS = ['https://api.maptiler.com', 'https://tile.openstreetmap.org'];

/**
 * Réduit une URL à son origine (`https://hôte:port`), en ignorant ce qui n'est
 * pas une URL absolue exploitable.
 *
 * Une CSP se raisonne par origine : y injecter une URL complète
 * (`http://localhost:3001/api`) décrit un chemin, pas une source, et produit
 * une directive plus étroite que voulu. Une valeur absente ou invalide
 * n'ajoute simplement aucune source — on ne comble jamais un trou de
 * configuration par une autorisation large.
 */
function toOrigin(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Déduplique en gardant l'ordre de déclaration (une CSP se relit de gauche à droite). */
function unique(sources: (string | undefined)[]): string[] {
  return [...new Set(sources.filter((source): source is string => Boolean(source)))];
}

/**
 * Construit la valeur de l'en-tête `Content-Security-Policy`.
 *
 * Chaque directive est justifiée — une CSP copiée-collée est une CSP qu'on
 * finit par désactiver au premier écran cassé :
 *
 * - `default-src 'self'` : tout ce qui n'est pas listé ci-dessous est interdit.
 * - `script-src 'self' 'nonce-…'` : c'est la directive qui **neutralise le XSS
 *   stocké ou réfléchi** (OWASP A03). Un script injecté dans le DOM n'a pas le
 *   nonce du jour, le navigateur refuse de l'exécuter. En développement,
 *   `'unsafe-eval'` est ajouté parce que le rechargement à chaud de Next.js
 *   compile en `eval` — ce desserrage ne quitte jamais la machine de dev.
 * - `style-src` tolère `'unsafe-inline'` : React et MapLibre posent des styles
 *   inline sur les éléments qu'ils animent. C'est l'assouplissement assumé de
 *   cette politique ; son impact est limité — injecter du CSS ne permet pas
 *   d'exécuter du code, au pire de dégrader l'affichage.
 * - `img-src` accepte `data:` (icônes inline) et `blob:` (tuiles assemblées par
 *   MapLibre), plus les deux fournisseurs de fonds de carte.
 * - `worker-src 'self' blob:` : MapLibre GL décode ses tuiles dans des workers
 *   créés depuis des blobs. Sans cette directive, la carte reste noire — c'est
 *   le premier écran qu'une CSP naïve casse.
 * - `connect-src` : liste **fermée** des destinations d'appels réseau — notre
 *   API, la Base Adresse Nationale, les tuiles. Elle vaut inventaire : aucun
 *   traceur tiers ne pourrait exfiltrer une adresse de départ sans apparaître
 *   ici (C8/C11).
 * - `frame-ancestors 'none'` : anti-clickjacking. Personne n'encadre l'écran de
 *   connexion d'UrbanFlow dans une page tierce.
 * - `form-action 'self'` / `base-uri 'self'` : un HTML injecté ne peut ni
 *   rediriger un formulaire vers un serveur pirate, ni réécrire la base des
 *   URL relatives de la page.
 * - `object-src 'none'` : plus aucun usage légitime des plugins.
 * - `upgrade-insecure-requests` en production seulement : en développement tout
 *   est en HTTP, la directive casserait `localhost`.
 *
 * @param options Nonce de la requête, mode de build et origines configurées
 * @returns La valeur prête à poser dans l'en-tête `Content-Security-Policy`
 */
export function buildContentSecurityPolicy(options: CspOptions): string {
  const { nonce, isDev } = options;
  const apiOrigin = toOrigin(options.apiUrl);
  const mapStyleOrigin = toOrigin(options.mapStyleUrl);

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', unique(["'self'", `'nonce-${nonce}'`, isDev ? "'unsafe-eval'" : undefined])],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', unique(["'self'", 'data:', 'blob:', ...TILE_ORIGINS, mapStyleOrigin])],
    ['font-src', ["'self'", 'data:']],
    [
      'connect-src',
      unique([
        "'self'",
        apiOrigin,
        BAN_ORIGIN,
        ...TILE_ORIGINS,
        mapStyleOrigin,
        // Rechargement à chaud de Next.js : websocket vers le serveur de dev.
        isDev ? 'ws:' : undefined,
      ]),
    ],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];

  const policy = directives.map(([name, sources]) => `${name} ${sources.join(' ')}`);
  if (!isDev) policy.push('upgrade-insecure-requests');

  return policy.join('; ');
}

/**
 * En-têtes de sécurité constants, appliqués à toutes les réponses du front
 * depuis `next.config.ts`.
 *
 * - `X-Content-Type-Options: nosniff` : le navigateur ne « devine » plus le
 *   type d'un fichier. Sans lui, un contenu servi avec le mauvais type peut
 *   être ré-interprété comme du script (OWASP A03).
 * - `X-Frame-Options: DENY` : doublon volontaire de `frame-ancestors`, pour les
 *   navigateurs anciens et pour les réponses statiques que le middleware — donc
 *   la CSP — ne traverse pas.
 * - `Referrer-Policy` : une adresse de départ peut se retrouver dans l'URL
 *   (`/?from=…`). En navigation externe, on n'envoie que l'origine, jamais le
 *   chemin ni la query (C8 — minimisation, C11).
 * - `Permissions-Policy` : coupe l'accès aux capteurs qu'UrbanFlow n'utilise
 *   pas, et **restreint la géolocalisation à notre propre origine** — une
 *   iframe tierce ne peut pas emprunter la permission accordée par
 *   l'utilisateur (C6/C8).
 * - `Cross-Origin-Opener-Policy` : isole notre onglet des fenêtres qu'il
 *   ouvrirait, condition d'isolation des processus navigateur.
 */
export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/**
 * En-tête HSTS, réservé à la production (UF-603/UF-604 — C11).
 *
 * Servi en développement, il condamnerait `http://localhost:3000` dans le
 * navigateur du développeur pour six mois — un cas réel et pénible à défaire.
 * En production, il double côté front la garantie déjà posée par l'API.
 */
export const HSTS_HEADER = {
  key: 'Strict-Transport-Security',
  value: 'max-age=15552000; includeSubDomains',
};
