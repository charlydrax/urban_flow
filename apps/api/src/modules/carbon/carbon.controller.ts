import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DEFAULT_CARBON_SUMMARY_DAYS } from '@urbanflow/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/strategies/jwt.strategy';
import { CarbonService } from './carbon.service';
import { CarbonSummaryDto, CarbonSummaryQueryDto } from './dto/carbon-summary.dto';

/**
 * Contrôleur du suivi carbone personnel (fonctionnalité au choix retenue).
 *
 * L'utilisateur n'accède qu'à SES propres statistiques : l'identité vient du
 * JWT vérifié par le guard global, et **aucune route n'accepte d'identifiant de
 * compte** — ni en chemin, ni en query, ni dans le corps. Viser le bilan
 * d'autrui n'est pas refusé, c'est inexprimable (C4 / OWASP A01 — recette 2 du
 * ticket UF-505).
 *
 * RGPD (C8) : ces agrégats décrivent les déplacements d'une personne. Ils ne
 * sortent que vers elle, et disparaissent avec son compte (cascade sur
 * `search_history`).
 */
@ApiTags('carbon')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée.' })
@Controller('carbon')
export class CarbonController {
  constructor(private readonly carbonService: CarbonService) {}

  /**
   * Suivi carbone du compte connecté sur une fenêtre glissante (UF-505) — la
   * matière de la page « Mon impact ».
   *
   * Remplace le `GET /carbon/dashboard` que UF-501 avait laissé en *stub* :
   * l'endpoint rendait des valeurs en dur, sans lire la base. Il n'avait aucun
   * appelant hors du squelette d'écran remplacé par ce même ticket, et le
   * conserver aurait laissé dans le contrat public une route qui ment.
   */
  @Get('summary')
  @ApiOperation({ summary: 'Suivi carbone personnel sur les N derniers jours' })
  @ApiOkResponse({ type: CarbonSummaryDto })
  @ApiBadRequestResponse({ description: '`days` hors de la liste autorisée (7, 30 ou 90).' })
  getSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CarbonSummaryQueryDto,
  ): Promise<CarbonSummaryDto> {
    return this.carbonService.getSummary(user.userId, query.days ?? DEFAULT_CARBON_SUMMARY_DAYS);
  }
}
