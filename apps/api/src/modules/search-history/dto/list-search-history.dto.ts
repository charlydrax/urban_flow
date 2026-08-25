import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_SEARCH_HISTORY_LIMIT,
  MAX_SEARCH_HISTORY_LIMIT,
  type SearchHistoryEntry,
  type SearchHistoryList,
} from '@urbanflow/shared';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { SearchHistoryPlaceDto } from './create-search-history.dto';

/**
 * Paramètres de `GET /api/search-history`.
 *
 * Le seul réglage exposé est la taille de la page. Il n'y a délibérément pas de
 * filtre par utilisateur : le périmètre de lecture est celui du JWT, point
 * (recette 2 du ticket — un compte ne voit QUE son historique).
 */
export class ListSearchHistoryQueryDto {
  /**
   * Nombre de recherches à retourner, de la plus récente à la plus ancienne.
   * Le plafond n'est pas décoratif : il empêche une requête unique de balayer
   * tout l'historique d'un compte et d'en faire transiter le poids sur un
   * réseau mobile (C5, C10).
   */
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_SEARCH_HISTORY_LIMIT,
    default: DEFAULT_SEARCH_HISTORY_LIMIT,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_HISTORY_LIMIT)
  limit?: number;
}

/** Une recherche enregistrée, telle qu'exposée par l'API (C9). */
export class SearchHistoryEntryDto implements SearchHistoryEntry {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: SearchHistoryPlaceDto })
  from!: SearchHistoryPlaceDto;

  @ApiProperty({ type: SearchHistoryPlaceDto })
  to!: SearchHistoryPlaceDto;

  /** Résumé de l'option retenue, `null` tant qu'aucune n'a été choisie. */
  @ApiProperty({ nullable: true, example: 'Marche + Métro B' })
  selectedSummary!: string | null;

  /** Empreinte en grammes de CO₂ de l'option retenue, `null` si inconnue. */
  @ApiProperty({ nullable: true, example: 14 })
  carbonGrams!: number | null;

  @ApiProperty({ format: 'date-time', example: '2026-07-31T09:12:00.000Z' })
  createdAt!: string;
}

/**
 * Réponse de `GET /api/search-history`.
 * Objet enveloppe plutôt que tableau nu : ajouter demain une pagination ou un
 * total ne cassera pas les clients déjà déployés (C9).
 */
export class SearchHistoryListDto implements SearchHistoryList {
  @ApiProperty({ type: [SearchHistoryEntryDto] })
  entries!: SearchHistoryEntryDto[];
}
