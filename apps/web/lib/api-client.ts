import type {
  AuthResponse,
  CarbonDashboard,
  CreateSearchHistoryPayload,
  PlanRouteRequest,
  PlanRoutesResponse,
  SearchHistoryEntry,
  SearchHistoryList,
  SessionUser,
  SourceDiagnosticsRequest,
  SourceDiagnosticsResponse,
  UpdateUserProfilePayload,
  UserProfile,
} from '@urbanflow/shared';

/** Erreur API normalisée (corps du filtre d'exceptions global côté NestJS). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Résout l'URL de base de l'API depuis l'environnement (UF-004) : jamais en dur.
 * En production, une variable absente est une erreur de configuration explicite
 * (fail-fast, C4) ; en développement seulement, repli sur l'API locale.
 */
function resolveBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not defined - set it in apps/web/.env (see apps/web/.env.example)',
    );
  }
  return 'http://localhost:3001/api';
}

const BASE_URL = resolveBaseUrl();

/** Réaction applicative à une session invalide — branchée par `SessionProvider` (UF-106). */
type UnauthorizedHandler = () => void;

let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Enregistre le traitement d'un 401 « session morte » (UF-106).
 *
 * Le client API ne connaît ni le routeur ni l'état React : il se contente de
 * **signaler** la perte de session, et c'est `SessionProvider` qui purge et
 * redirige. Cette inversion garde `lib/` testable et sans dépendance à Next.
 *
 * @param handler Rappel invoqué sur tout 401 d'une route protégée
 * @returns Fonction de désinscription (à appeler au démontage)
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): () => void {
  onUnauthorized = handler;
  return () => {
    if (onUnauthorized === handler) onUnauthorized = null;
  };
}

/** Options internes du client API (non transmises à `fetch`). */
interface RequestOptions extends RequestInit {
  /**
   * Ne pas déclencher le traitement global du 401.
   * Réservé aux endpoints d'authentification : sur `/auth/login`, un 401 veut
   * dire « identifiants faux », pas « session expirée » — le rediriger vers
   * l'écran de connexion depuis l'écran de connexion ferait perdre le message.
   */
  skipUnauthorizedHandler?: boolean;
}

/**
 * Appel générique vers l'API Gateway.
 *
 * `credentials: 'include'` : le JWT circule via le cookie httpOnly posé par
 * l'API — jamais stocké dans localStorage (C11).
 *
 * Intercepteur de session (UF-106) : un `401` sur une route protégée signifie
 * que le guard JWT de la Gateway a rejeté le token (absent, falsifié, expiré —
 * flux de référence, étape 2). On notifie alors l'application, qui purge la
 * session et renvoie vers `/login`. L'erreur est **quand même levée**, pour que
 * l'appelant puisse arrêter proprement son rendu.
 */
async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const { skipUnauthorizedHandler, ...init } = options ?? {};

  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });

  if (!response.ok) {
    if (response.status === 401 && !skipUnauthorizedHandler) {
      onUnauthorized?.();
    }
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(response.status, message ?? `Erreur API ${response.status}`);
  }
  // 204 No Content (déconnexion) : pas de corps à parser.
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/**
 * Client API typé de la PWA — point d'accès unique vers l'API NestJS.
 * Couvre : C9 (consomme le contrat REST documenté), C11 (cookies httpOnly).
 */
export const apiClient = {
  /** Inscription (F1). */
  register(email: string, password: string): Promise<AuthResponse> {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipUnauthorizedHandler: true,
    });
  },

  /** Connexion (F1). Un 401 = identifiants faux, traité par le formulaire lui-même. */
  login(email: string, password: string): Promise<AuthResponse> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipUnauthorizedHandler: true,
    });
  },

  /**
   * Sonde de session (UF-106) : renvoie l'identité du compte connecté, ou lève
   * une `ApiError` 401 si la session n'est plus valide côté API.
   */
  getSession(): Promise<SessionUser> {
    return request('/auth/me');
  },

  /**
   * Déconnexion (UF-106) : demande à l'API de purger le cookie `httpOnly`.
   * Le JS ne peut pas l'effacer lui-même (C11), d'où l'aller-retour serveur.
   * `skipUnauthorizedHandler` : purger une session déjà morte ne doit pas
   * relancer le traitement de 401 (risque de boucle).
   */
  logout(): Promise<void> {
    return request('/auth/logout', { method: 'POST', skipUnauthorizedHandler: true });
  },

  /**
   * Profil de mobilité du compte connecté (F1, UF-107).
   * L'API le résout depuis le token : aucun identifiant ne transite côté client,
   * il n'y a donc rien à falsifier pour viser le profil d'autrui (C4).
   */
  getProfile(): Promise<UserProfile> {
    return request('/users/me');
  },

  /**
   * Enregistre tout ou partie du profil (F1, UF-107).
   * `PATCH` : seuls les champs réellement modifiés sont envoyés (C5, C10).
   * @param payload Champs à modifier — un champ absent reste inchangé en base
   */
  updateProfile(payload: UpdateUserProfilePayload): Promise<UserProfile> {
    return request('/users/me', { method: 'PATCH', body: JSON.stringify(payload) });
  },

  /**
   * Planification d'itinéraires multimodaux (F2) — étape 1 du flux de référence.
   * La réponse est mise en cache par le service worker pour l'accès hors-ligne (C1/C10).
   */
  planRoutes(payload: PlanRouteRequest): Promise<PlanRoutesResponse> {
    return request('/routes/plan', { method: 'POST', body: JSON.stringify(payload) });
  },

  /**
   * Enregistre la recherche qui vient d'être lancée (UF-204) — étape 18 du flux.
   * Le trajet est rattaché au compte du cookie de session : aucun identifiant
   * n'est envoyé, il n'y a donc rien à falsifier côté client (C4).
   */
  createSearchHistory(payload: CreateSearchHistoryPayload): Promise<SearchHistoryEntry> {
    return request('/search-history', { method: 'POST', body: JSON.stringify(payload) });
  },

  /**
   * Dernières recherches du compte connecté (UF-204), affichées en rappels
   * sous les champs de saisie.
   * @param limit Nombre d'entrées voulu — l'API borne à 20 et sert 5 par défaut (C5)
   */
  getSearchHistory(limit?: number): Promise<SearchHistoryList> {
    const query = limit === undefined ? '' : `?limit=${limit}`;
    return request(`/search-history${query}`);
  },

  /**
   * [dev] Données brutes des trois sources pour un trajet (UF-306).
   *
   * Endpoint **temporaire** de vérification du Sprint 3 : il ne fusionne rien et
   * disparaîtra avec l'arrivée des vrais itinéraires (Sprint 4). Il est fermé
   * hors développement — un `404` en production n'est donc pas une panne, c'est
   * le comportement attendu.
   *
   * @param payload Deux extrémités, ou `searchHistoryId` pour rejouer une recherche (UF-204)
   */
  testRouteSources(payload: SourceDiagnosticsRequest): Promise<SourceDiagnosticsResponse> {
    return request('/routes/sources', { method: 'POST', body: JSON.stringify(payload) });
  },

  /** Tableau de bord carbone personnel. */
  getCarbonDashboard(): Promise<CarbonDashboard> {
    return request('/carbon/dashboard');
  },
};
