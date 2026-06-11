import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/strategies/jwt.strategy';
import { UpdateMobilityProfileDto } from './dto/update-mobility-profile.dto';
import { MobilityProfileView, UsersService, UserView } from './users.service';

/**
 * Contrôleur utilisateurs (F1) — endpoints protégés par le guard JWT global.
 * L'identité vient exclusivement du token (C4) ; seules les données strictement
 * nécessaires sont exposées (minimisation RGPD — C8).
 */
@ApiTags('users')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Profil du compte connecté (stub). */
  @Get('me')
  @ApiOperation({ summary: 'Profil du compte connecté (stub)' })
  @ApiOkResponse({ description: 'Profil minimal (id, email).' })
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserView> {
    return this.usersService.getMe(user.userId);
  }

  /** Préférences de mobilité du compte connecté (stub). */
  @Get('me/mobility-profile')
  @ApiOperation({ summary: 'Préférences de mobilité (stub)' })
  @ApiOkResponse({ description: 'Modes préférés, PMR (C12), marche max.' })
  getMobilityProfile(@CurrentUser() user: AuthenticatedUser): Promise<MobilityProfileView> {
    return this.usersService.getMobilityProfile(user.userId);
  }

  /** Mise à jour des préférences de mobilité (stub : écho validé). */
  @Put('me/mobility-profile')
  @ApiOperation({ summary: 'Met à jour les préférences de mobilité (stub)' })
  @ApiOkResponse({ description: 'Préférences enregistrées.' })
  updateMobilityProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMobilityProfileDto,
  ): Promise<MobilityProfileView> {
    return this.usersService.updateMobilityProfile(user.userId, dto);
  }
}
