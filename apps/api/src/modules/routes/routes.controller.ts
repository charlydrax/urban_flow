import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/strategies/jwt.strategy';
import { PLAN_THROTTLE_LIMIT, ThrottlePlan } from '../../common/throttling';
import { PlanRoutesResponseDto } from './dto/itinerary.dto';
import { PlanRouteDto } from './dto/plan-route.dto';
import { RoutesService } from './routes.service';

/**
 * Contrôleur du planificateur d'itinéraires (F2).
 *
 * Un seul endpoint depuis UF-402 : `POST /routes/plan`, définitif. Le
 * diagnostic `POST /routes/sources` (UF-306), qui rendait les données brutes des
 * trois sources sans les fusionner, a été **retiré** — il avait servi à valider
 * la chaîne des connecteurs avant que la fusion n'existe, et le maintenir aurait
 * laissé en production une route qui publie la cause technique de nos pannes
 * (C11). Voir `docs/source-diagnostics-endpoint.md` pour ce qu'il faisait et
 * comment le rejouer au besoin.
 *
 * Protégé par le guard JWT global : token absent, invalide ou expiré → `401`
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
   * Les trois sources (GTFS, GBFS, PostGIS) sont interrogées **en parallèle**
   * (UF-305), puis **fusionnées** en itinéraires de bout en bout (UF-401) :
   * tout-TC, TC avec rabattement à vélo, vélo en libre-service porte-à-porte,
   * marche seule sur une courte distance. Plus aucun itinéraire n'est simulé.
   *
   * Trois sources muettes donnent un `200` avec une liste vide, jamais un
   * `500` : un code d'erreur ferait croire à l'usager que sa requête est
   * fautive, alors que ce sont nos sources qui manquent (C10).
   *
   * Endpoint **plafonné** (UF-604) : c'est le plus coûteux du système, et le
   * seul qui amplifie une requête entrante en trois requêtes sortantes.
   */
  @ThrottlePlan()
  @Post('plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calcule les itinéraires multimodaux + empreinte CO₂',
    description:
      'Corps : `{ from, to }` — **pas de `userId`**, l’auteur de la recherche est le porteur ' +
      'du JWT (C4). Les trois sources sont ' +
      'interrogées en parallèle (UF-305) : le temps de réponse suit la plus lente, pas la ' +
      'somme des trois. Elles sont ensuite fusionnées en itinéraires continus (UF-401) — ' +
      'tout-TC, TC + vélo en rabattement, vélo seul, marche seule si c’est court — au plus ' +
      'cinq, filtrés puis classés selon les préférences du profil (marche maximale, ' +
      'accessibilité PMR, priorité rapide ou écolo). Le champ `sources` rapporte laquelle a ' +
      'répondu : une liste sans option vélo et un opérateur injoignable ne se lisent pas pareil. ' +
      'La recherche est enregistrée dans l’historique (UF-204) à chaque appel, et ' +
      '`searchHistoryId` renvoie la ligne créée.',
  })
  @ApiOkResponse({
    type: PlanRoutesResponseDto,
    description:
      'Itinéraires classés selon `sortedBy` (empreinte croissante par défaut, durée pour un ' +
      'profil « rapide »), et état des trois sources. Renvoyé même quand toutes les sources ' +
      'ont échoué : la liste est alors vide et `sources` dit pourquoi.',
  })
  @ApiUnauthorizedResponse({ description: 'JWT absent, invalide ou expiré.' })
  @ApiBadRequestResponse({
    description:
      'Corps invalide, ou extrémité sans coordonnées : le géocodage est fait par le client (C4).',
  })
  @ApiTooManyRequestsResponse({
    description:
      `Plus de ${PLAN_THROTTLE_LIMIT} calculs par minute depuis la même IP (UF-604). ` +
      'Chaque appel relaie trois requêtes vers des sources externes : le plafond protège ' +
      'aussi leurs quotas, partagés par tous nos utilisateurs.',
  })
  plan(
    @Body() dto: PlanRouteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlanRoutesResponseDto> {
    // C4 : l'identité vient du JWT seul — le corps n'a plus de `userId` à opposer.
    return this.routesService.plan(dto, user.userId);
  }
}
