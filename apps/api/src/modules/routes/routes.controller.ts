import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
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
   * Planifie des itinéraires multimodaux entre deux lieux.
   *
   * Depuis UF-305, les trois sources (GTFS, GBFS, PostGIS) sont réellement
   * interrogées **en parallèle**, et leur état est rapporté dans `sources`.
   * Les itinéraires eux-mêmes restent des mocks jusqu'à la fusion (Sprint 4).
   *
   * Trois sources muettes donnent un `200` avec une liste vide, jamais un
   * `500` : un code d'erreur ferait croire à l'usager que sa requête est
   * fautive, alors que ce sont nos sources qui manquent (C10).
   */
  @Post('plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calcule les itinéraires multimodaux + empreinte CO₂',
    description:
      'Contrat du diagramme de séquence MVP : { from, to, userId }. Les trois sources sont ' +
      'interrogées en parallèle (UF-305) : le temps de réponse suit la plus lente, pas la ' +
      'somme des trois. Le champ `sources` rapporte laquelle a répondu — une liste sans ' +
      'option vélo et un opérateur injoignable ne se lisent pas pareil. ' +
      '⚠️ Les itinéraires sont encore des mocks (fusion : Sprint 4) ; `sources`, lui, est réel.',
  })
  @ApiOkResponse({
    type: PlanRoutesResponseDto,
    description:
      'Itinéraires triés par empreinte croissante, et état des trois sources. Renvoyé même ' +
      'quand toutes les sources ont échoué : la liste est alors vide et `sources` dit pourquoi.',
  })
  @ApiUnauthorizedResponse({ description: 'JWT absent, invalide ou expiré.' })
  @ApiBadRequestResponse({
    description:
      'Corps invalide, ou extrémité sans coordonnées : le géocodage est fait par le client (C4).',
  })
  plan(
    @Body() dto: PlanRouteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlanRoutesResponseDto> {
    // C4 : l'identité du JWT prime sur dto.userId (anti-usurpation)
    return this.routesService.plan(dto, user.userId);
  }
}
