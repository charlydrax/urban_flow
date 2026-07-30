/**
 * Contrats d'authentification (F1) — endpoints `POST /api/auth/*`.
 */

/**
 * Identité du compte connecté, telle que portée par le JWT vérifié.
 * Données volontairement minimales (minimisation RGPD — C8).
 */
export interface SessionUser {
  id: string;
  email: string;
}

/** Réponse des endpoints d'authentification (le token JWT vit en cookie httpOnly — C11). */
export interface AuthResponse {
  accessToken: string;
  user: SessionUser;
}
