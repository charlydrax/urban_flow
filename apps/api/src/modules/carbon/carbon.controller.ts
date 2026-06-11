import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/strategies/jwt.strategy';
import { CarbonDashboard, CarbonService } from './carbon.service';

/**
 * Contrôleur du suivi carbone personnel (fonctionnalité au choix retenue).
 * L'utilisateur n'accède qu'à SES propres statistiques (identité JWT — C4/C8).
 */
@ApiTags('carbon')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@Controller('carbon')
export class CarbonController {
  constructor(private readonly carbonService: CarbonService) {}

  /** Tableau de bord carbone du compte connecté (stub). */
  @Get('dashboard')
  @ApiOperation({ summary: 'Tableau de bord carbone personnel (stub)' })
  @ApiOkResponse({ description: 'CO₂ émis/évité et nombre de trajets sur la période.' })
  getDashboard(@CurrentUser() user: AuthenticatedUser): Promise<CarbonDashboard> {
    return this.carbonService.getDashboard(user.userId);
  }
}
