import type {
  AuthResponse,
  CarbonSummary,
  CarbonSummaryDays,
  CreateSearchHistoryPayload,
  PlanRouteRequest,
  PlanRoutesResponse,
  SearchHistoryEntry,
  SearchHistoryList,
  SelectItineraryPayload,
  SessionUser,
  UpdateUserProfilePayload,
  UserProfile,
} from '@urbanflow/shared';

import { isServedFromCache } from './offline';

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
  /**
   * Inspecte la réponse brute avant qu'elle ne soit consommée (UF-601).
   *
   * Le client rend des objets typés, pas des `Response` : c'est ce qui le rend
   * agréable à appeler. Mais le service worker communique par un **en-tête**
   * (`X-UrbanFlow-Cache`), invisible dans le corps. Ce rappel est la plus
   * petite ouverture qui laisse un appelant lire cette information sans que
   * tous les autres aient à démêler une enveloppe.
   */
  onResponse?: (response: Response) => void;
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
  const { skipUnauthorizedHandler, onResponse, ...init } = options ?? {};

  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });

  onResponse?.(response);

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
 * Résultat d'une planification, **avec sa provenance** (UF-601).
 *
 * La provenance ne peut pas être un champ de `PlanRoutesResponse` : ce type est
 * le contrat partagé avec l'API (`@urbanflow/shared`), et le serveur ne sait
 * rien du cache du navigateur. C'est une information du transport, elle
 * s'ajoute donc autour du corps de la réponse, pas dedans.
 */
export interface PlanRoutesResult {
  /** Corps de la réponse, au contrat `@urbanflow/shared` habituel. */
  response: PlanRoutesResponse;
  /**
   * `true` quand le service worker a servi le dernier itinéraire mémorisé au
   * lieu d'un calcul frais — l'écran doit alors le dire (C10).
   */
  servedFromCache: boolean;
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
   *
   * Le corps ne porte que les deux extrémités : depuis UF-402, l'API refuse un
   * `userId` (400) et lit l'identité dans le cookie de session (C4).
   *
   * Elle **enregistre elle-même** la recherche dans l'historique et rend la
   * ligne créée dans `searchHistoryId` : appeler `createSearchHistory` après un
   * `planRoutes` créerait un doublon.
   *
   * La réponse est mise en cache par le service worker pour l'accès hors-ligne
   * (C1/C10) : hors réseau, c'est le **dernier itinéraire mémorisé** qui
   * revient, et `servedFromCache` le signale — voir {@link PlanRoutesResult}.
   */
  planRoutes(payload: PlanRouteRequest): Promise<PlanRoutesResult> {
    let servedFromCache = false;
    return request<PlanRoutesResponse>('/routes/plan', {
      method: 'POST',
      body: JSON.stringify(payload),
      onResponse: (response) => {
        servedFromCache = isServedFromCache(response.headers);
      },
    }).then((response) => ({ response, servedFromCache }));
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
   * Inscrit sur une recherche l'itinéraire que l'usager vient de **retenir**
   * (UF-505) — ce qui alimente la page « Mon impact ».
   *
   * Le corps ne porte **aucune empreinte** : seulement le résumé de l'option et
   * ses segments (mode + distance). C'est le Service Carbone qui valorise, côté
   * serveur, au même barème que la liste de résultats. Envoyer les grammes
   * depuis le navigateur permettrait de se fabriquer un bilan flatteur, et un
   * bilan qu'on peut se fabriquer ne vaut plus rien.
   *
   * @param searchHistoryId Ligne rendue par `planRoutes` dans `searchHistoryId`
   * @param payload Résumé de l'option retenue et ses segments
   */
  recordItinerarySelection(
    searchHistoryId: string,
    payload: SelectItineraryPayload,
  ): Promise<SearchHistoryEntry> {
    return request(`/search-history/${searchHistoryId}/selection`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Suivi carbone personnel sur une fenêtre glissante (UF-505).
   * L'API résout le compte depuis le cookie de session : aucun identifiant ne
   * transite, il n'y a donc rien à falsifier pour viser le bilan d'autrui (C4).
   * @param days Durée de la période — l'API n'accepte que 7, 30 ou 90 (C5)
   */
  getCarbonSummary(days?: CarbonSummaryDays): Promise<CarbonSummary> {
    const query = days === undefined ? '' : `?days=${days}`;
    return request(`/carbon/summary${query}`);
  },
};
