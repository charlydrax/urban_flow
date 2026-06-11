import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard JWT global de l'API Gateway.
 *
 * Conformément au flux de référence (CLAUDE.md section 4, étape 2) : toute requête
 * est authentifiée au niveau du gateway ; un JWT absent/invalide/expiré → 401.
 * Les routes annotées `@Public()` (login, register, health) sont exemptées.
 *
 * Couvre : C4 (authentification par défaut), C11 (le token est lu en priorité
 * depuis un cookie httpOnly — voir JwtStrategy).
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
    return super.canActivate(context);
  }
}
