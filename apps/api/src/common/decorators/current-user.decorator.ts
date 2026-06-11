import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Injecte l'utilisateur authentifié (extrait du JWT par la stratégie Passport)
 * dans un paramètre de contrôleur.
 *
 * L'identité provient TOUJOURS du token vérifié, jamais d'un champ du corps de
 * la requête : empêche l'usurpation d'identité / IDOR (C4).
 *
 * @example
 * ```ts
 * @Get('me')
 * me(@CurrentUser() user: AuthenticatedUser) { ... }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as AuthenticatedUser;
  },
);
