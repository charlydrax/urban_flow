import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Injecte l'utilisateur authentifié **ou `null`** sur une route à
 * authentification facultative (UF-801).
 *
 * Jumeau de `@CurrentUser()`, à une différence près qui est tout l'intérêt :
 * il rend `null` au lieu d'un objet, et le **type** l'annonce. Sur une route
 * `@OptionalAuth()`, `@CurrentUser()` mentirait au compilateur — il promet un
 * `AuthenticatedUser` là où la requête d'un invité n'en porte aucun, et le
 * premier `user.userId` écrit de bonne foi planterait en production, pour les
 * seuls visiteurs non connectés.
 *
 * Comme `@CurrentUser()`, l'identité vient **toujours** du token vérifié par la
 * stratégie Passport, jamais du corps de la requête (anti-IDOR — C4).
 *
 * @example
 * ```ts
 * @OptionalAuth()
 * @Post('plan')
 * plan(@OptionalUser() user: AuthenticatedUser | null) {
 *   return this.service.plan(dto, user?.userId ?? null);
 * }
 * ```
 */
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | null => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request.user as AuthenticatedUser | undefined) ?? null;
  },
);
