import { SetMetadata } from '@nestjs/common';

import { UserRole } from '../enums/user-role.enum';

/** Clé de métadonnée lue par le `RolesGuard` pour connaître les rôles admis. */
export const ROLES_KEY = 'requiredRoles';

/**
 * Réserve un endpoint (ou tout un contrôleur) à certains rôles (UF-701 — C4).
 *
 * ## Ce que le décorateur pose, et ce qu'il ne pose pas
 *
 * Il n'authentifie rien : le `JwtAuthGuard` global l'a déjà fait, et une route
 * annotée sans jeton valide répond `401` bien avant que le `RolesGuard` ne
 * s'exécute. Le décorateur répond à la question **suivante** — « ce compte
 * a-t-il le droit ? » — et la réponse négative est un `403`, pas un `401` :
 * confondre les deux ferait renvoyer un usager parfaitement connecté vers
 * l'écran de connexion, où se reconnecter ne lui donnerait rien de plus.
 *
 * ## Le rôle n'est pas lu dans le jeton
 *
 * Le `RolesGuard` relit le rôle **en base** à chaque requête. Le JWT en porte
 * pourtant une copie (voir `SessionUser.role`), mais elle ne sert qu'à
 * l'affichage : un jeton vit quinze minutes, et une autorisation accordée sur
 * une revendication vieille de quinze minutes est une autorisation qu'on ne
 * peut pas révoquer (OWASP A01). Voir `guards/roles.guard.ts`.
 *
 * ## Sécurité par défaut
 *
 * L'absence de décorateur ne réserve rien — un endpoint sans `@Roles()` reste
 * ouvert à tout compte authentifié, comme il l'a toujours été. La sécurité par
 * défaut de cette API porte sur l'**authentification** (guard JWT global) ;
 * l'autorisation, elle, est nominative parce qu'il n'existe qu'une frontière
 * de rôle dans le produit. La rendre implicite obligerait à annoter les
 * quarante endpoints qui n'en ont pas besoin, et un oubli y serait invisible.
 *
 * @param roles Rôles admis — l'un d'eux suffit
 *
 * @example
 * ```ts
 * @Roles(UserRole.ADMIN)
 * @Post('trip')
 * simulate(@Body() dto: SimulateTripDto) { ... }
 * ```
 */
export const Roles = (...roles: UserRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
