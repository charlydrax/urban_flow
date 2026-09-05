import type { UserRole } from './user-role';

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
  /**
   * Rôle du compte (UF-701) — **pour l'interface, jamais pour l'autorisation**.
   *
   * Il est là parce que le front doit savoir quoi peindre dès le premier
   * rendu : le bouton « Simuler le déplacement » n'existe que pour un
   * exploitant, et le faire apparaître après un aller-retour réseau le ferait
   * clignoter sur chaque chargement de page. Le porter dans le jeton est donc
   * un choix d'affichage, et il en a le prix : une révocation de droits n'est
   * visible à l'écran qu'à la fin de la session (15 min).
   *
   * ⚠️ Ce que ce champ **ne fait pas** : ouvrir un accès. Toute décision
   * d'autorisation est prise côté serveur, en relisant le rôle en base
   * (`RolesGuard`) — un jeton périmé quant aux droits, ou forgé si le secret
   * fuitait, n'obtient rien de plus qu'un `403` (C4 / OWASP A01). Cacher le
   * bouton est du confort ; le `403` est la sécurité.
   */
  role: UserRole;
}

/** Réponse des endpoints d'authentification (le token JWT vit en cookie httpOnly — C11). */
export interface AuthResponse {
  accessToken: string;
  user: SessionUser;
}
