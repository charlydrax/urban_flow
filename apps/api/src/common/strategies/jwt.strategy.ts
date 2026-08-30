import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';

import { accessTokenExtractor } from '../access-token';

/** Charge utile signée dans les access tokens UrbanFlow. */
export interface JwtPayload {
  /** Identifiant de l'utilisateur (UUID). */
  sub: string;
  /** Email de l'utilisateur (affichage / journalisation côté client uniquement). */
  email: string;
}

/** Utilisateur authentifié injecté dans `request.user` après validation du token. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
}

/**
 * Stratégie Passport de vérification des JWT.
 *
 * Le token est extrait par `accessTokenExtractor` (cookie httpOnly `access_token`
 * d'abord, en-tête `Authorization: Bearer` ensuite) — voir `common/access-token.ts`,
 * qui sert aussi au guard facultatif d'UF-801.
 *
 * Couvre : C4 (signature vérifiée, expiration appliquée), C11 (cookie httpOnly).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: accessTokenExtractor,
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Transforme la charge utile vérifiée en objet utilisateur de requête.
   * @param payload Charge utile du JWT (déjà vérifiée par passport-jwt)
   * @returns L'utilisateur attaché à `request.user`
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    return { userId: payload.sub, email: payload.email };
  }
}
