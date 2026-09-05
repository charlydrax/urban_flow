import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';

import { accessTokenExtractor } from '../access-token';
import { DEFAULT_USER_ROLE, UserRole } from '../enums/user-role.enum';

/** Charge utile signée dans les access tokens UrbanFlow. */
export interface JwtPayload {
  /** Identifiant de l'utilisateur (UUID). */
  sub: string;
  /** Email de l'utilisateur (affichage / journalisation côté client uniquement). */
  email: string;
  /**
   * Rôle du compte à l'émission du jeton (UF-701) — **affichage uniquement**.
   *
   * Il est là pour que la PWA sache quoi peindre dès le premier rendu serveur
   * (le bouton « Simuler le déplacement » n'existe que pour un exploitant),
   * sans un aller-retour réseau à chaque chargement de page.
   *
   * ⚠️ Aucune décision d'autorisation ne s'appuie dessus : le `RolesGuard`
   * relit le rôle en base à chaque appel réservé, précisément parce que cette
   * revendication est figée pour la durée de vie du jeton et qu'une
   * revendication est une donnée portée par le demandeur (C4 / OWASP A01).
   *
   * Facultative dans le type : un jeton émis avant UF-701 n'en porte pas, et
   * il reste parfaitement valide jusqu'à son expiration. `validate` retombe
   * alors sur le rôle par défaut — le moins-disant, jamais le plus-disant.
   */
  role?: UserRole;
}

/** Utilisateur authentifié injecté dans `request.user` après validation du token. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  /**
   * Rôle porté par le jeton (UF-701). À ne lire que pour de l'affichage ou de
   * la journalisation : l'autorisation se décide dans `RolesGuard`, sur le
   * rôle relu en base.
   */
  role: UserRole;
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
    // Repli sur le rôle par défaut, jamais sur un privilège : un jeton émis
    // avant UF-701 ne porte pas de revendication `role`, et un jeton forgé
    // pourrait en porter une fantaisiste. Dans les deux cas, le moins-disant.
    return { userId: payload.sub, email: payload.email, role: payload.role ?? DEFAULT_USER_ROLE };
  }
}
