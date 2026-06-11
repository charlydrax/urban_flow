import type {
  AuthResponse,
  CarbonDashboard,
  PlanRouteRequest,
  PlanRoutesResponse,
} from './api-types';

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

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * Appel générique vers l'API Gateway.
 * `credentials: 'include'` : le JWT circule via le cookie httpOnly posé par
 * l'API — jamais stocké dans localStorage (C11).
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(response.status, message ?? `Erreur API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Client API typé de la PWA — point d'accès unique vers l'API NestJS.
 * Couvre : C9 (consomme le contrat REST documenté), C11 (cookies httpOnly).
 */
export const apiClient = {
  /** Inscription (F1). */
  register(email: string, password: string): Promise<AuthResponse> {
    return request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
  },

  /** Connexion (F1). */
  login(email: string, password: string): Promise<AuthResponse> {
    return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  },

  /**
   * Planification d'itinéraires multimodaux (F2) — étape 1 du flux de référence.
   * La réponse est mise en cache par le service worker pour l'accès hors-ligne (C1/C10).
   */
  planRoutes(payload: PlanRouteRequest): Promise<PlanRoutesResponse> {
    return request('/routes/plan', { method: 'POST', body: JSON.stringify(payload) });
  },

  /** Tableau de bord carbone personnel. */
  getCarbonDashboard(): Promise<CarbonDashboard> {
    return request('/carbon/dashboard');
  },
};
