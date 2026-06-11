import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
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
import { PlanRoutesResponseDto } from './dto/itinerary.dto';
import { PlanRouteDto } from './dto/plan-route.dto';
import { RoutesService } from './routes.service';

/**
 * Contrôleur du planificateur d'itinéraires (F2).
 * Endpoint protégé par le guard JWT global : token invalide/expiré → 401
 * (étape 2 du flux de référence — C4).
 */
@ApiTags('routes')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  /**
   * Planifie des itinéraires multimodaux entre deux lieux (stub : réponse mock
   * conforme au scénario nominal Part-Dieu → Bellecour, triée par CO₂ croissant).
   */
  @Post('plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calcule les itinéraires multimodaux + empreinte CO₂ (stub)',
    description:
      'Contrat du diagramme de séquence MVP : { from, to, userId }. ' +
      'Réponse : itinéraires multimodaux avec CO₂ par segment, triés par empreinte croissante.',
  })
  @ApiOkResponse({ type: PlanRoutesResponseDto })
  @ApiUnauthorizedResponse({ description: 'JWT absent, invalide ou expiré.' })
  @ApiNotFoundResponse({ description: 'Aucun trajet trouvé entre ces deux points.' })
  plan(
    @Body() dto: PlanRouteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlanRoutesResponseDto> {
    // C4 : l'identité du JWT prime sur dto.userId (anti-usurpation)
    return this.routesService.plan(dto, user.userId);
  }
}
