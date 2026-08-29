import { Body, Controller, Delete, Get, Patch, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { DeleteAccountResult } from '@urbanflow/shared';
import { Response } from 'express';

import { clearAuthCookie } from '../../common/auth-cookie';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/strategies/jwt.strategy';
import { DeleteAccountResultDto } from './dto/delete-account-result.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UsersService, UserProfileView } from './users.service';

/**
 * Contrôleur utilisateurs (F1, UF-107) — endpoints protégés par le guard JWT global.
 *
 * Le chemin `me` n'est pas un raccourci de confort : c'est le **seul** moyen de
 * désigner un profil. Aucune route n'accepte d'identifiant en paramètre, donc
 * aucune requête ne peut viser le profil d'un autre compte — l'identité vient
 * exclusivement du token vérifié (C4 / OWASP A01, recette 2 du ticket).
 *
 * Les données exposées sont réduites au strict nécessaire (minimisation RGPD — C8) :
 * ni hash de mot de passe, ni token, ni historique.
 *
 * Depuis UF-603, le module porte aussi le **droit à l'effacement** (`DELETE me`) :
 * consulter, rectifier et supprimer ses données se font au même endroit, ce qui
 * est aussi ce que l'utilisateur cherche quand il ouvre son profil.
 */
@ApiTags('users')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée.' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Profil complet du compte connecté : identité, consentement RGPD et préférences. */
  @Get('me')
  @ApiOperation({ summary: 'Profil du compte connecté (identité + préférences de mobilité)' })
  @ApiOkResponse({ description: 'Profil du compte connecté.' })
  @ApiNotFoundResponse({ description: 'Compte supprimé alors que le token est encore valide.' })
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserProfileView> {
    return this.usersService.getProfile(user.userId);
  }

  /**
   * Mise à jour **partielle** du profil : consentement géolocalisation et/ou
   * préférences de mobilité. `PATCH` (et non `PUT`) car l'UI enregistre parfois
   * un seul réglage : réémettre tout le profil serait de la charge utile
   * gaspillée et exposerait à l'écrasement concurrent (C5, C10).
   */
  @Patch('me')
  @ApiOperation({ summary: 'Met à jour le profil et les préférences de mobilité (partiel)' })
  @ApiOkResponse({ description: 'Profil enregistré, relu depuis la base.' })
  @ApiBadRequestResponse({ description: 'Corps invalide (validation class-validator — C4).' })
  @ApiNotFoundResponse({ description: 'Compte supprimé alors que le token est encore valide.' })
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<UserProfileView> {
    return this.usersService.updateProfile(user.userId, dto);
  }

  /**
   * Efface le compte connecté et toutes ses données — droit à l'effacement
   * (art. 17 RGPD, C8 ; recette 3 du ticket UF-603).
   *
   * `DELETE /users/me`, sans identifiant ni corps : comme les deux routes
   * précédentes, le compte visé est celui du token vérifié et lui seul. Il n'y a
   * donc structurellement aucune requête capable de supprimer le compte d'autrui
   * (C4 / OWASP A01) — la protection ne repose pas sur un contrôle qu'on
   * pourrait oublier, mais sur l'absence de paramètre.
   *
   * La réponse est un `200` porteur du **décompte de ce qui a disparu**, pas un
   * `204` muet : exercer un droit sans en recevoir la preuve d'exécution n'aide
   * ni l'utilisateur, ni la recette du ticket.
   *
   * Le cookie de session est purgé dans la foulée. Le JWT déjà émis reste
   * cryptographiquement valide jusqu'à expiration — on ne peut pas révoquer un
   * jeton sans état — mais il ne désigne plus rien : toute route protégée
   * répondra 404, et le navigateur n'a de toute façon plus de cookie à envoyer.
   */
  @Delete('me')
  @ApiOperation({ summary: 'Supprime le compte connecté et toutes ses données (RGPD art. 17)' })
  @ApiOkResponse({ type: DeleteAccountResultDto })
  @ApiNotFoundResponse({ description: 'Compte déjà supprimé alors que le token est valide.' })
  async deleteMe(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeleteAccountResult> {
    const result = await this.usersService.deleteAccount(user.userId);
    // Après le service : un échec de suppression ne doit pas déconnecter.
    clearAuthCookie(res);
    return result;
  }
}
