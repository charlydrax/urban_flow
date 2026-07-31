import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/strategies/jwt.strategy';
import { CreateSearchHistoryDto } from './dto/create-search-history.dto';
import {
  ListSearchHistoryQueryDto,
  SearchHistoryEntryDto,
  SearchHistoryListDto,
} from './dto/list-search-history.dto';
import { SearchHistoryService } from './search-history.service';

/**
 * Contrôleur de l'historique de recherche (UF-204) — endpoints protégés par le
 * guard JWT global (aucun `@Public()` ici : un historique anonyme n'existe pas).
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
   * Enregistre la recherche que l'utilisateur vient de lancer (étape 18 du flux).
   *
   * `201 Created` avec l'entrée relue : le client récupère l'`id` et
   * l'horodatage réels, et peut afficher le nouveau rappel sans redemander
   * toute la liste (C5 — un aller-retour économisé).
   */
  @Post()
  @ApiOperation({ summary: 'Enregistre une recherche d’itinéraire pour le compte connecté' })
  @ApiCreatedResponse({ type: SearchHistoryEntryDto })
  @ApiBadRequestResponse({
    description: 'Corps invalide : coordonnées manquantes ou hors bornes WGS84 (C4).',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSearchHistoryDto,
  ): Promise<SearchHistoryEntryDto> {
    return this.searchHistoryService.create(user.userId, dto);
  }

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
}
