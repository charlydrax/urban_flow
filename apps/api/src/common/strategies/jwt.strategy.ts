import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

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
 * Le token est extrait en priorité depuis le cookie httpOnly `access_token`
 * (inaccessible au JavaScript → protège contre le vol par XSS — C11), avec
 * repli sur l'en-tête `Authorization: Bearer` (tests Swagger, clients API).
 *
 * Couvre : C4 (signature vérifiée, expiration appliquée), C11 (cookie httpOnly).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request): string | null => (req.cookies?.access_token as string | undefined) ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
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
