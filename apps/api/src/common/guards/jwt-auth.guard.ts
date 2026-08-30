import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Observable } from 'rxjs';

import { hasAccessTokenCredentials } from '../access-token';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Guard JWT global de l'API Gateway.
 *
 * Conformément au flux de référence (CLAUDE.md section 4, étape 2) : toute requête
 * est authentifiée au niveau du gateway ; un JWT absent/invalide/expiré → 401.
 *
 * Trois régimes, du plus ouvert au plus strict :
 *
 * | Régime               | Jeton absent          | Jeton invalide | Jeton valide           |
 * | -------------------- | --------------------- | -------------- | ---------------------- |
 * | `@Public()`          | passe, `user` vide    | passe, `user` vide | passe, **`user` vide** |
 * | `@OptionalAuth()`    | passe, `user` vide    | `401`          | passe, `user` renseigné |
 * | (défaut)             | `401`                 | `401`          | passe, `user` renseigné |
 *
 * La ligne `@Public()` explique pourquoi UF-801 n'a pas pu s'en contenter pour
 * ouvrir le planificateur aux invités : la stratégie n'y est jamais jouée, donc
 * un utilisateur **connecté** y perdrait son identité — et avec elle son profil
 * de mobilité et son historique (voir `decorators/optional-auth.decorator.ts`).
 *
 * Couvre : C4 (authentification par défaut, exemptions nominatives), C11 (le
 * token est lu en priorité depuis un cookie httpOnly — voir JwtStrategy).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    // Les routes `@OptionalAuth()` passent par le chemin normal : c'est
    // `handleRequest` qui décide seul de tolérer l'anonymat, une fois la
    // stratégie jouée et le jeton — s'il y en avait un — vérifié.
    return super.canActivate(context);
  }

  /**
   * Décide du sort d'une requête dont l'authentification n'a pas abouti.
   *
   * Le comportement hérité — toujours lever un `401` — reste la règle. Sur une
   * route `@OptionalAuth()` (UF-801), une seule situation y échappe : celle où
   * **aucun identifiant n'a été présenté**. Le visiteur est alors un invité, et
   * la requête poursuit avec `request.user` vide (`AuthGuard.canActivate`
   * affecte la valeur rendue ici, puis rend `true`).
   *
   * Un jeton présent mais rejeté — expiré, forgé, tronqué — reste un `401`,
   * même sur ces routes. Le dégrader en visite anonyme ferait perdre sa session
   * à un utilisateur sans qu'aucun écran ne le lui dise : il continuerait à
   * chercher des itinéraires en croyant son compte actif, sans historique ni
   * bilan carbone, et sans redirection vers la reconnexion (UF-106).
   *
   * @param err Erreur remontée par la stratégie Passport
   * @param user Utilisateur validé, ou `false` si l'authentification a échoué
   * @param info Détail passport (jeton manquant, expiré…) — non exposé au client (C11)
   * @param context Contexte d'exécution, d'où sont relus les métadonnées et la requête
   * @returns L'utilisateur authentifié, ou `undefined` pour un invité toléré
   */
  override handleRequest<TUser = AuthenticatedUser>(
    err: Error | null,
    user: TUser | false,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (!err && !user && this.isOptionalAuth(context) && !this.presentsCredentials(context)) {
      // `undefined` et non `null` : c'est la valeur qu'AuthGuard écrira dans
      // `request.user`, et `null` y ferait passer un objet là où le reste du
      // code teste l'absence.
      return undefined as TUser;
    }
    return super.handleRequest<TUser>(err, user, info, context);
  }

  /** La route accepte-t-elle les visiteurs non connectés (UF-801) ? */
  private isOptionalAuth(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }

  /** La requête portait-elle un jeton, quel qu'en soit l'état ? */
  private presentsCredentials(context: ExecutionContext): boolean {
    return hasAccessTokenCredentials(context.switchToHttp().getRequest<Request>());
  }
}
