import { Body, Controller, Get, Patch } from '@nestjs/common';
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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/strategies/jwt.strategy';
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
}
