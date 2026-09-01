import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/strategies/jwt.strategy';
import { CompleteTripDto } from './dto/complete-trip.dto';
import {
  ListSearchHistoryQueryDto,
  SearchHistoryEntryDto,
  SearchHistoryListDto,
} from './dto/list-search-history.dto';
import { SelectItineraryDto } from './dto/select-itinerary.dto';
import { SearchHistoryService } from './search-history.service';

/**
 * Contrôleur de l'historique de recherche (UF-204) — endpoints protégés par le
 * guard JWT global (aucun `@Public()` ici : un historique anonyme n'existe pas).
 *
 * ## Ce contrôleur ne crée rien (depuis UF-807)
 *
 * Les lignes d'historique naissent **uniquement** de `POST /api/routes/plan`
 * (étape 7 du flux), qui en rend l'identifiant dans `searchHistoryId`. Le
 * `POST /api/search-history` livré par UF-204 n'avait plus d'appelant depuis
 * UF-403 : l'émettre en plus du plan aurait produit deux lignes pour un seul
 * trajet, et son corps acceptait un nombre de grammes venu du navigateur — ce
 * qu'UF-505 avait justement cessé de faire. Il est retiré plutôt que rebranché ;
 * un endpoint d'écriture sans appelant n'est pas une réserve, c'est une porte
 * qu'on oublie de surveiller (C4).
 *
 * Restent donc trois routes : lire ses trajets, dire l'option retenue, dire le
 * trajet parcouru.
 *
 * Comme `/users/me`, **aucune route n'accepte d'identifiant de compte** : ni en
 * paramètre de chemin, ni en query, ni dans le corps. L'utilisateur désigné est
 * toujours le porteur du token vérifié, ce qui rend structurellement impossible
 * de lire ou d'alimenter l'historique d'autrui (C4 / OWASP A01 — recette 2 du
 * ticket).
 *
 * RGPD (C8) : les trajets sont des données personnelles par recoupement. Ils ne
 * sortent d'ici que vers leur propriétaire, et disparaissent avec le compte
 * (suppression en cascade côté base).
 */
@ApiTags('search-history')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée.' })
@Controller('search-history')
export class SearchHistoryController {
  constructor(private readonly searchHistoryService: SearchHistoryService) {}

  /**
   * Les dernières recherches du compte connecté — les « trajets récents »
   * affichés sous les champs de saisie du planificateur.
   */
  @Get()
  @ApiOperation({ summary: 'Les N dernières recherches du compte connecté' })
  @ApiOkResponse({ type: SearchHistoryListDto })
  @ApiBadRequestResponse({ description: '`limit` hors bornes (1 à 20).' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSearchHistoryQueryDto,
  ): Promise<SearchHistoryListDto> {
    const entries = await this.searchHistoryService.findRecent(user.userId, query.limit);
    return { entries };
  }

  /**
   * Enregistre l'itinéraire **retenu** pour une recherche déjà consignée
   * (UF-505) — ce qui alimente le suivi carbone personnel.
   *
   * `PATCH` et non `PUT` : la ligne existe déjà et seuls le résumé et
   * l'empreinte sont posés dessus ; les extrémités du trajet, elles, ne
   * changent pas et n'ont pas à être renvoyées (C5).
   *
   * L'UUID vient du chemin, donc du client — d'où le `ParseUUIDPipe`, qui
   * refuse en 400 ce qui n'est pas un identifiant avant que la valeur
   * n'atteigne le SQL (C4), et la restriction au propriétaire côté service, qui
   * répond 404 pour la ligne d'autrui (OWASP A01).
   */
  @Patch(':id/selection')
  @ApiOperation({ summary: 'Enregistre l’itinéraire retenu pour une recherche' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Ligne d’historique à compléter.' })
  @ApiOkResponse({ type: SearchHistoryEntryDto })
  @ApiBadRequestResponse({ description: 'Identifiant non-UUID ou corps invalide (C4).' })
  @ApiNotFoundResponse({
    description: 'Recherche inconnue — ou appartenant à un autre compte (OWASP A01).',
  })
  recordSelection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelectItineraryDto,
  ): Promise<SearchHistoryEntryDto> {
    return this.searchHistoryService.recordSelection(user.userId, id, dto);
  }

  /**
   * Marque un trajet **réalisé** : le guidage est arrivé à destination (UF-807).
   *
   * ## Pourquoi cet endpoint existe
   *
   * `PATCH .../selection` enregistre une **intention** — l'option qu'on regarde.
   * Jusqu'ici le suivi carbone comptait cela, c'est-à-dire des trajets que
   * personne n'avait forcément faits. C'est l'arrivée effective qui fait un
   * déplacement, et c'est elle que cette route consigne.
   *
   * ## `POST` et non `PATCH`
   *
   * L'appel consigne un **événement** — « je suis arrivé » — et non la
   * modification d'un champ que le client choisirait. L'horodatage est celui du
   * serveur, le corps ne le porte pas. Rejouer l'appel est sans effet
   * supplémentaire (`COALESCE` côté service) : le client peut donc réessayer
   * après une coupure réseau à l'arrivée, sans dupliquer ni décaler un trajet.
   *
   * `200 OK` et non `201 Created` : rien n'est créé, une ligne existante change
   * d'état et est rendue telle qu'elle est désormais.
   */
  @Post(':id/completion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marque un trajet comme réalisé (arrivée du guidage)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Trajet parcouru.' })
  @ApiOkResponse({ type: SearchHistoryEntryDto })
  @ApiBadRequestResponse({ description: 'Identifiant non-UUID ou corps invalide (C4).' })
  @ApiNotFoundResponse({
    description: 'Recherche inconnue — ou appartenant à un autre compte (OWASP A01).',
  })
  recordCompletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteTripDto,
  ): Promise<SearchHistoryEntryDto> {
    return this.searchHistoryService.recordCompletion(user.userId, id, dto);
  }
}
