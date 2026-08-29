import { resolveApiBaseUrl } from './api-base-url';

/**
 * Remontée des erreurs de l'interface vers l'API (UF-607).
 *
 * ## Le problème que ça résout
 *
 * Quand un écran de la PWA plante, le serveur ne voit **rien** : sa requête a
 * réussi, c'est le rendu qui a échoué. En préproduction, ces pannes-là ne sont
 * connues que si un testeur pense à les raconter — et il les raconte mal, parce
 * qu'un message d'erreur JavaScript ne se recopie pas de tête. Ce module les
 * fait arriver dans le **même flux de journaux** que les erreurs serveur.
 *
 * ## Ce qui n'est jamais envoyé (C8/C11)
 *
 * Ni l'URL complète, ni la `query string`, ni les adresses saisies, ni
 * l'identité du compte. Le signalement porte le **nom de l'écran**, le message
 * d'erreur et deux clés de corrélation techniques. Une trace de bogue n'a pas
 * besoin de savoir où va l'usager, et ce qui n'est pas collecté n'a pas à être
 * protégé.
 */

/** Écrans reconnus par l'API (`ReportClientErrorDto.screen`). */
export type ClientErrorScreen =
  | 'planner'
  | 'login'
  | 'register'
  | 'profile'
  | 'impact'
  | 'privacy'
  | 'unknown';

/** Corps envoyé à `POST /api/diagnostics/client-errors`. */
export interface ClientErrorReport {
  message: string;
  name?: string;
  screen: ClientErrorScreen;
  /** Identifiant de corrélation du dernier appel d'API observé. */
  requestId?: string;
  /** Empreinte d'erreur produite par Next.js pour un rendu serveur. */
  digest?: string;
}

/** Longueur maximale du message, alignée sur la validation serveur. */
const MAX_MESSAGE_LENGTH = 300;

/**
 * Correspondance chemin → écran.
 *
 * Une liste fermée, plutôt que le `pathname` brut : le chemin peut porter des
 * paramètres, et une URL recopiée telle quelle finirait par emporter une
 * adresse de départ dans nos journaux. On envoie ce dont le diagnostic a
 * besoin — quel écran a cassé — et rien de plus.
 */
const SCREEN_BY_PATH: Record<string, ClientErrorScreen> = {
  '/': 'planner',
  '/login': 'login',
  '/register': 'register',
  '/profil': 'profile',
  '/impact': 'impact',
  '/confidentialite': 'privacy',
};

/**
 * Identifie l'écran d'origine d'une erreur à partir du chemin courant.
 * @param pathname Chemin de la page (`window.location.pathname`)
 * @returns Le nom d'écran attendu par l'API, `'unknown'` si le chemin n'est pas connu
 */
export function screenFromPathname(pathname: string | undefined): ClientErrorScreen {
  if (pathname === undefined) return 'unknown';
  // Le chemin est normalisé (barre finale retirée) pour que `/impact/` et
  // `/impact` ne produisent pas deux étiquettes différentes dans les journaux.
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return SCREEN_BY_PATH[normalized] ?? 'unknown';
}

/**
 * Identifiant de corrélation du dernier appel d'API observé.
 *
 * Mémorisé dans le module — un seul onglet, un seul flux d'appels — parce que
 * le composant qui attrape l'erreur ne connaît pas la requête qui l'a précédée.
 * C'est ce qui permet de lire, côté serveur, la requête et l'erreur d'écran
 * qu'elle a provoquée sous **une même clé**.
 */
let lastApiRequestId: string | undefined;

/**
 * Mémorise l'identifiant de corrélation d'une réponse de l'API.
 * Appelée par `api-client.ts` sur chaque réponse, succès comme échec.
 * @param headers En-têtes de la réponse reçue
 */
export function recordApiRequestId(headers: Headers): void {
  const requestId = headers.get('x-request-id');
  if (requestId) lastApiRequestId = requestId;
}

/** Dernier identifiant de corrélation observé, ou `undefined` avant tout appel. */
export function getLastApiRequestId(): string | undefined {
  return lastApiRequestId;
}

/**
 * Construit le corps du signalement à partir d'une erreur attrapée.
 *
 * Fonction pure et exportée : c'est elle qui décide ce qui part vers le
 * serveur, donc c'est elle qu'on doit pouvoir mettre sous test (le respect de
 * C11 ne se vérifie pas à l'œil sur une fonction d'envoi).
 *
 * @param error Erreur attrapée par une frontière React
 * @param pathname Chemin de la page au moment de l'erreur
 * @returns Le corps prêt à être envoyé, sans donnée personnelle
 */
export function buildClientErrorReport(error: unknown, pathname?: string): ClientErrorReport {
  const asError = error instanceof Error ? error : undefined;
  const rawMessage = asError?.message ?? (typeof error === 'string' ? error : 'Unknown error');
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String((error as { digest?: unknown }).digest)
      : undefined;

  const report: ClientErrorReport = {
    // Message vide (erreur sans message, promesse rejetée sans motif) : une
    // chaîne vide serait refusée par la validation serveur, et un signalement
    // rejeté ne vaut pas mieux que pas de signalement.
    message: (rawMessage.trim() || 'Unknown error').slice(0, MAX_MESSAGE_LENGTH),
    screen: screenFromPathname(pathname),
  };
  if (asError?.name) report.name = asError.name;
  if (lastApiRequestId !== undefined) report.requestId = lastApiRequestId;
  if (digest !== undefined && digest !== 'undefined') report.digest = digest;

  return report;
}

/**
 * Envoie le signalement à l'API, sans jamais faire échouer l'appelant.
 *
 * `keepalive` : l'erreur peut survenir juste avant que l'usager ne quitte la
 * page ; sans lui, le navigateur annulerait la requête et le seul témoin de la
 * panne disparaîtrait avec l'onglet.
 *
 * Les échecs sont avalés — volontairement. Le signalement est un service rendu
 * à l'équipe, pas à l'usager : le faire remonter à l'écran d'erreur
 * reviendrait à afficher l'erreur de l'erreur. Hors ligne (C10), il n'y a rien
 * à envoyer et rien à dire.
 *
 * @param error Erreur attrapée par une frontière React
 * @param pathname Chemin de la page au moment de l'erreur
 */
export function reportClientError(error: unknown, pathname?: string): void {
  if (typeof window === 'undefined') return;

  const report = buildClientErrorReport(error, pathname);

  try {
    void fetch(`${resolveApiBaseUrl()}/diagnostics/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
      // Pas de `credentials` : l'endpoint est ouvert et n'a que faire de savoir
      // qui signale. Ne pas envoyer le cookie de session, c'est refuser de lier
      // une trace technique à un compte (C8 — minimisation).
    }).catch(() => undefined);
  } catch {
    // `resolveApiBaseUrl` peut lever si la PWA est mal configurée : ce n'est
    // pas à l'écran d'erreur de le signaler bruyamment.
  }
}

/** Textes de l'écran d'erreur — le composant peint, il ne rédige pas (C7). */
export const ERROR_SCREEN = {
  title: 'Cette page n’a pas pu s’afficher',
  message:
    'Une erreur inattendue est survenue. Vos données sont intactes : vous pouvez réessayer, ' +
    'ou revenir à la planification.',
  retry: 'Réessayer',
  home: 'Retour à l’accueil',
  /** Précède l'identifiant de corrélation, à recopier dans un signalement. */
  referenceLabel: 'Référence à indiquer en cas de signalement',
} as const;
