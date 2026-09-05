import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums/user-role.enum';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

/**
 * Guard d'autorisation par rôle (UF-701) — le « 403 si non-admin » de la
 * recette du ticket.
 *
 * Déclaré **après** le `JwtAuthGuard` dans `AppModule` : quand celui-ci
 * s'exécute, l'authentification a déjà eu lieu et `request.user` porte
 * l'identité du jeton vérifié. La séparation des deux étapes est ce qui donne
 * les deux codes de réponse attendus (C4 / OWASP A01) :
 *
 * | Situation                        | Réponse | Pourquoi                              |
 * | -------------------------------- | ------- | ------------------------------------- |
 * | Aucun jeton / jeton invalide     | `401`   | rendu par le guard JWT, avant celui-ci |
 * | Compte valide, rôle insuffisant  | `403`   | authentifié, mais pas autorisé        |
 * | Compte valide, rôle admis        | passe   |                                       |
 *
 * Renvoyer `401` au second cas renverrait un usager parfaitement connecté vers
 * l'écran de connexion, où se reconnecter ne lui donnerait rien de plus.
 *
 * ## Le rôle est relu en base, jamais lu dans le jeton
 *
 * C'est le seul point réellement délicat de ce guard, et il est délibéré. Le
 * JWT porte bien une revendication `role` — le front en a besoin pour savoir
 * quoi peindre — mais l'autorisation ne s'y fie pas :
 *
 * - un jeton vit quinze minutes ; retirer les droits d'un compte ne doit pas
 *   attendre son expiration pour prendre effet ;
 * - une revendication est une donnée **portée par le demandeur**. La base est
 *   la seule chose que le demandeur ne tient pas.
 *
 * Le prix est une requête par appel réservé — une lecture par clé primaire,
 * sur des endpoints d'outillage interne appelés quelques fois par
 * démonstration. C'est un coût que les endpoints publics, eux, ne paient pas :
 * sans `@Roles()`, ce guard rend `true` sans toucher à la base (C5).
 *
 * ## Un compte effacé n'est pas un compte autorisé
 *
 * Si la lecture ne rend aucune ligne, c'est un `403` et non une erreur : un
 * jeton encore valide peut désigner un compte supprimé entre-temps (droit à
 * l'effacement — C8, UF-603). L'absence de compte n'accorde évidemment rien.
 *
 * Couvre : C4 (contrôle d'accès serveur, décision prise sur l'état courant et
 * non sur une revendication), C11 (le refus ne dit ni le rôle attendu ni le
 * rôle porté — voir le message).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Route sans exigence de rôle : rien à vérifier, et surtout aucune requête
    // en base à payer (C5). C'est le cas de l'immense majorité des endpoints.
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;

    // Défense en profondeur : une route annotée `@Roles()` mais aussi
    // `@Public()` / `@OptionalAuth()` pourrait arriver ici sans identité. Un
    // rôle ne se vérifie pas sur un anonyme — refus, plutôt qu'un plantage.
    if (!user?.userId) throw new ForbiddenException('Insufficient permissions');

    const account = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { role: true },
    });

    // Comparaison à une liste connue : un rôle inconnu lu en base (valeur
    // écrite à la main, migration future) n'ouvre rien par accident.
    if (!account || !required.includes(account.role as UserRole)) {
      // Message volontairement muet sur le rôle attendu comme sur le rôle
      // porté : un refus n'a pas à cartographier les privilèges de l'API pour
      // qui les cherche (C11).
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
