import type { SessionUser } from '@urbanflow/shared';

/**
 * Primitives de session côté front (UF-106) — sans dépendance à Next ni au DOM,
 * donc utilisables à la fois dans le middleware (runtime Edge), dans les Server
 * Components et dans les composants clients, et testables unitairement.
 *
 * ⚠️ Périmètre de confiance : **rien ici n'est une frontière de sécurité**. Le
 * token n'est jamais vérifié cryptographiquement côté front (le `JWT_SECRET` ne
 * doit pas quitter l'API — C4/C11). Ces fonctions servent uniquement à décider
 * *ce qu'on affiche et où on redirige*. L'autorité reste l'API Gateway, qui
 * vérifie signature et expiration à chaque requête (flux de référence, étape 2)
 * et renvoie 401 le cas échéant.
 */

/** Nom du cookie httpOnly posé par l'API (`AuthController.setAuthCookie`). */
export const SESSION_COOKIE = 'access_token';

/** Écran de connexion — destination de toutes les redirections de session. */
export const LOGIN_PATH = '/login';

/** Page servie après connexion quand aucune destination n'est mémorisée. */
export const DEFAULT_AFTER_LOGIN = '/';

/** Paramètre de requête portant la page demandée avant la redirection. */
export const NEXT_PARAM = 'next';

/** Paramètre de requête expliquant *pourquoi* l'utilisateur a été redirigé. */
export const REASON_PARAM = 'reason';

/**
 * Motifs de redirection vers /login, utilisés pour le message affiché (C7).
 *
 * `account-deleted` (UF-603) est distinct de `signed-out` : « vous avez été
 * déconnecté » après une suppression de compte laisserait croire qu'il suffit de
 * se reconnecter. L'écran doit confirmer l'effacement, pas le masquer.
 */
export type LogoutReason = 'auth-required' | 'session-expired' | 'signed-out' | 'account-deleted';

/**
 * Écrans d'authentification : publics, **et interdits à qui est déjà connecté**.
 * Afficher un formulaire de connexion à une session valide n'a aucun sens.
 */
const AUTH_PATHS = ['/login', '/register'] as const;

/**
 * Pages lisibles sans session mais qui restent lisibles **avec** (UF-603, UF-801).
 *
 * La politique de confidentialité en est le premier cas : elle doit être
 * consultable avant de créer un compte — c'est la condition d'un consentement
 * éclairé (C8) — sans pour autant éjecter vers l'accueil l'utilisateur connecté
 * qui vient y relire la durée de conservation de ses trajets. La distinction
 * avec `AUTH_PATHS` n'est donc pas cosmétique : confondre les deux rendrait la
 * page inaccessible à la moitié des gens qu'elle concerne.
 *
 * Le **planificateur** (`/`) l'a rejointe avec UF-801 : chercher et comparer
 * des itinéraires est le service rendu à tous, et le réserver aux inscrits
 * revenait à faire payer en données personnelles une information publique (C8).
 * Un compte reste nécessaire pour ce qui appartient à quelqu'un — historique,
 * bilan carbone, profil —, qui reste privé par défaut.
 *
 * ⚠️ `/` est comparé **à l'identique**, jamais en préfixe : `matchesAny`
 * n'accepterait `/impact` que si la liste contenait la chaîne vide. Ajouter une
 * page publique ici n'ouvre donc rien d'autre qu'elle-même.
 */
const OPEN_PATHS = ['/', '/confidentialite'] as const;

/**
 * Routes accessibles sans session. Tout le reste est privé par défaut :
 * un oubli d'inscription à cette liste ferme la porte, il ne l'ouvre pas.
 */
const PUBLIC_PATHS = [...AUTH_PATHS, ...OPEN_PATHS] as const;

/** Teste l'appartenance d'un chemin à une liste (préfixe complet, jamais partiel). */
function matchesAny(pathname: string, paths: readonly string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** Charge utile minimale attendue dans l'access token (miroir de `JwtPayload` côté API). */
interface TokenClaims {
  /** Identifiant utilisateur (UUID). */
  sub: string;
  email: string;
  /** Expiration, en **secondes** epoch (standard JWT — attention au ×1000). */
  exp?: number;
}

/** Indique si un chemin est accessible **sans** session (aucune redirection vers /login). */
export function isPublicPath(pathname: string): boolean {
  return matchesAny(pathname, PUBLIC_PATHS);
}

/**
 * Indique si un chemin est un écran d'authentification, dont un utilisateur
 * **déjà connecté** doit être détourné (UF-106).
 */
export function isAuthPath(pathname: string): boolean {
  return matchesAny(pathname, AUTH_PATHS);
}

/** Décodage base64url compatible Edge/Node/navigateur (pas de `Buffer`). */
function decodeBase64Url(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    // atob rend une chaîne binaire : on la repasse en UTF-8 pour les emails accentués.
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Lit les revendications d'un access token **sans vérifier sa signature**.
 *
 * Un token falsifié passerait donc ce décodage : c'est assumé et sans risque,
 * car il serait rejeté par l'API à la première requête (401 → purge + login).
 * Le but est seulement d'éviter d'afficher une page privée à quelqu'un dont on
 * sait *déjà* que la session est absente ou périmée.
 *
 * @param token Valeur brute du cookie `access_token`
 * @returns Les revendications lisibles, ou `null` si le token est illisible
 */
export function readTokenClaims(token: string | undefined | null): TokenClaims | null {
  if (!token) return null;

  const [, payload] = token.split('.');
  if (!payload) return null;

  const json = decodeBase64Url(payload);
  if (!json) return null;

  try {
    const claims = JSON.parse(json) as Partial<TokenClaims>;
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') return null;
    return { sub: claims.sub, email: claims.email, exp: claims.exp };
  } catch {
    return null;
  }
}

/**
 * Session déduite du cookie : l'utilisateur, ou `null` si absent/expiré.
 * @param token Valeur brute du cookie `access_token`
 * @param now Horodatage en millisecondes (injectable pour les tests)
 */
export function readSession(
  token: string | undefined | null,
  now = Date.now(),
): SessionUser | null {
  const claims = readTokenClaims(token);
  if (!claims) return null;
  // `exp` est en secondes (RFC 7519) ; un token sans exp est traité comme expiré,
  // l'API en émet toujours une (JWT_EXPIRES_IN).
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null;
  return { id: claims.sub, email: claims.email };
}

/**
 * Nettoie la destination demandée avant redirection.
 *
 * Seuls les chemins **internes** sont acceptés : un `next=https://evil.tld` ou
 * `next=//evil.tld` transformerait l'écran de connexion en tremplin de phishing
 * (redirection ouverte — OWASP A01, C4). Le paramètre étant fourni par l'URL,
 * il est traité comme une entrée utilisateur hostile.
 *
 * @param raw Valeur brute du paramètre `next`
 * @returns Un chemin interne sûr, ou `null` si la valeur est refusée
 */
export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Un seul « / » en tête, et pas de « /\ » : élimine //host et /\host.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  // Un chemin interne ne contient jamais de schéma (javascript:, data:, http:).
  if (raw.includes(':')) return null;
  // Ne jamais renvoyer vers un écran d'authentification : on tournerait en rond
  // après connexion. Les autres pages publiques (politique de confidentialité)
  // restent des destinations valides — on y était, on doit y revenir.
  if (isAuthPath(raw)) return null;
  return raw;
}

/**
 * Construit l'URL de l'écran de connexion en mémorisant la page demandée.
 * @param from Chemin (+ query) de la page privée refusée
 * @param reason Motif, pour afficher le bon message sur /login (C7)
 */
export function buildLoginUrl(
  from?: string | null,
  reason: LogoutReason = 'auth-required',
): string {
  const params = new URLSearchParams({ [REASON_PARAM]: reason });
  const next = sanitizeNextPath(from);
  if (next) params.set(NEXT_PARAM, next);
  return `${LOGIN_PATH}?${params.toString()}`;
}
