/**
 * Rôle d'un compte (UF-701) — le vocabulaire du contrôle d'accès, partagé
 * front/back comme le reste des contrats (C9).
 *
 * Deux valeurs, et volontairement pas une de plus : ce prototype n'a qu'une
 * frontière d'autorisation à tracer, celle qui sépare l'usager de la
 * métropole de l'outillage interne (le mode simulation d'UF-701). Inventer
 * dès maintenant une hiérarchie de rôles — modérateur, exploitant, support —
 * décrirait une organisation qui n'existe pas et laisserait des branches de
 * code que rien ne parcourt.
 *
 * ⚠️ **Le rôle est une donnée du compte, pas une donnée de session.** Il est
 * porté par le JWT pour que l'interface sache quoi peindre (voir
 * `SessionUser.role`), mais l'autorisation, elle, est toujours tranchée en
 * base côté serveur : un jeton vit quinze minutes, une révocation de droits
 * doit prendre effet immédiatement (C4 / OWASP A01). Voir
 * `apps/api/src/common/guards/roles.guard.ts`.
 */
export enum UserRole {
  /** Usager de la métropole — le rôle par défaut de tout compte créé. */
  USER = 'user',
  /**
   * Exploitant de la plateforme : accède en plus à l'outillage interne
   * (mode simulation de trajet — UF-701). Ne se crée pas par l'inscription,
   * seulement par le seed de démonstration ou une écriture en base.
   */
  ADMIN = 'admin',
}

/** Rôle attribué à tout compte créé par `POST /api/auth/register` (F1). */
export const DEFAULT_USER_ROLE = UserRole.USER;
