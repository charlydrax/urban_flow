/**
 * Contrats d'authentification (F1) — endpoints `POST /api/auth/*`.
 */

/** Réponse des endpoints d'authentification (le token JWT vit en cookie httpOnly — C11). */
export interface AuthResponse {
  accessToken: string;
  user: { id: string; email: string };
}
