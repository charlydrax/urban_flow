import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
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
import { PlanRoutesResponseDto } from './dto/itinerary.dto';
import { PlanRouteDto } from './dto/plan-route.dto';
import { TestSourcesDto, TestSourcesResponseDto } from './dto/test-sources.dto';
import { RoutesService } from './routes.service';
import { SourceDiagnosticsService } from './sources/source-diagnostics.service';

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
  constructor(
    private readonly routesService: RoutesService,
    private readonly sourceDiagnostics: SourceDiagnosticsService,
  ) {}

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

  /**
   * Interroge les trois sources et rend leurs données **brutes**, sans fusion
   * (UF-306) — endpoint interne de vérification du Sprint 3.
   *
   * ⚠️ **Temporaire.** Il disparaîtra au Sprint 4, quand `POST /routes/plan`
   * rendra de vrais itinéraires fusionnés. Il existe pour valider la chaîne
   * complète — GTFS, GBFS, PostGIS — avant qu'on ne construise par-dessus :
   * une fusion qui rend une liste vide ne dit pas si le tort revient à la
   * fusion ou à une source muette.
   *
   * Protégé comme le reste du contrôleur : le guard JWT global répond `401`
   * sans token valide (recette 2 du ticket). Il est de surcroît **éteint hors
   * développement** (`404`), parce qu'il publie la cause technique des pannes.
   */
  @Post('sources')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[dev] Données brutes des trois sources, sans fusion',
    description:
      'Déclenche la collecte parallèle (UF-305) et renvoie ce que chaque source a rendu, ' +
      'séparément : trajets TC (GTFS/OTP), stations en libre-service (GBFS) aux deux ' +
      'extrémités, tronçons cyclables (PostGIS) aux deux extrémités. ' +
      'Le corps accepte `{ from, to }`, ou `{ searchHistoryId }` pour rejouer une recherche ' +
      'enregistrée (UF-204). ' +
      '⚠️ Endpoint de développement, désactivé en production (404) et destiné à disparaître ' +
      'au profit de `/routes/plan` au Sprint 4.',
  })
  @ApiOkResponse({
    type: TestSourcesResponseDto,
    description:
      'Données brutes des trois sources, avec la durée de chacune. Renvoyé même quand les ' +
      'trois ont échoué : `allSourcesFailed` vaut alors `true` et chaque source dit pourquoi.',
  })
  @ApiUnauthorizedResponse({ description: 'JWT absent, invalide ou expiré.' })
  @ApiBadRequestResponse({
    description: 'Corps invalide : ni `{ from, to }` complets, ni `searchHistoryId`.',
  })
  @ApiNotFoundResponse({
    description:
      'Endpoint désactivé sur cet environnement, ou `searchHistoryId` absent de votre historique.',
  })
  testSources(
    @Body() dto: TestSourcesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TestSourcesResponseDto> {
    // C4 : l'historique et les préférences sont lus sur le compte du JWT.
    return this.sourceDiagnostics.testSources(dto, user.userId);
  }
}
