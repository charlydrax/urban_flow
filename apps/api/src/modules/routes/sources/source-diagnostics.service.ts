import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SourceDiagnostics, SourceDiagnosticsResponse } from '@urbanflow/shared';

import { SearchHistoryService } from '../../search-history/search-history.service';
import { UsersService } from '../../users/users.service';
import { TestSourcesDto } from '../dto/test-sources.dto';
import type { SourceName, SourceOutcome } from './collected-sources';
import { SourceCollectorService, type RouteEndpoint } from './source-collector.service';

/**
 * Variable qui autorise explicitement l'endpoint de diagnostic.
 * `'true'` l'active, `'false'` l'éteint ; absente, c'est `NODE_ENV` qui décide.
 */
const DEBUG_FLAG = 'ROUTES_SOURCES_DEBUG';

/**
 * Service du diagnostic des sources (UF-306) — ce qui fait tourner
 * `POST /api/routes/sources`.
 *
 * ## À quoi il sert
 *
 * Il rejoue les étapes 3 et 13-18 du flux de référence — lecture des préférences
 * puis collecte parallèle — et **rend les données brutes** au lieu de les
 * fusionner. C'est le point de vérification end-to-end du Sprint 3 : avant
 * d'écrire la fusion multimodale, on veut voir de ses yeux que les trois
 * connecteurs répondent, avec quelles données et en combien de temps.
 *
 * ## Pourquoi il ne passe pas par `RoutesService.plan`
 *
 * `plan` fusionnera, calculera le CO₂ et enregistrera la recherche. Un
 * diagnostic qui l'emprunterait mesurerait donc autre chose que les sources, et
 * ne saurait plus dire laquelle des deux étapes a échoué. Les deux services
 * partagent ce qui doit l'être — `UsersService` et `SourceCollectorService` — et
 * rien de plus.
 *
 * ## Pourquoi il n'écrit pas dans `search_history`
 *
 * Il **lit** l'historique, pour rejouer un trajet ; il n'y écrit jamais. Sonder
 * l'infrastructure n'est pas un déplacement : inscrire ces appels parmi les
 * trajets de l'usager fausserait ses rappels récents et, à terme, son tableau de
 * bord carbone. Minimisation (C8) : on enregistre ce qui décrit l'usager, pas ce
 * qui décrit nos serveurs.
 *
 * ## Pourquoi il est éteint en production
 *
 * La réponse porte la **cause technique réelle** de chaque panne, là où
 * `SourceAvailability` s'en tient à un vocabulaire pauvre pour ne rien dire de
 * notre topologie (C11). C'est utile en développement et indéfendable en
 * production. L'endpoint répond donc `404` hors développement, sauf
 * `ROUTES_SOURCES_DEBUG=true` explicite. `404` et non `403` : un refus
 * confirmerait l'existence de la route, une route inconnue n'apprend rien.
 *
 * Couvre : F2, F3, C4 (validation, anti-IDOR, surface réduite en production),
 * C8 (aucune écriture d'historique), C10 (collecte parallèle observable),
 * C11 (détail technique confiné au développement), C12 (préférence PMR appliquée).
 */
@Injectable()
export class SourceDiagnosticsService {
  private readonly logger = new Logger(SourceDiagnosticsService.name);

  /** `true` quand l'endpoint de diagnostic est autorisé sur cet environnement. */
  private readonly enabled: boolean;

  constructor(
    private readonly users: UsersService,
    private readonly collector: SourceCollectorService,
    private readonly searchHistory: SearchHistoryService,
    config: ConfigService,
  ) {
    const flag = config.get<string>(DEBUG_FLAG);
    // Le drapeau explicite prime ; sans lui, la production est fermée. Le défaut
    // sûr est le silence, jamais l'ouverture (C4).
    this.enabled = flag === undefined ? process.env.NODE_ENV !== 'production' : flag === 'true';

    if (!this.enabled) {
      this.logger.log(
        `Endpoint de diagnostic des sources désactivé sur cet environnement (${DEBUG_FLAG}).`,
      );
    }
  }

  /**
   * Interroge les trois sources pour un trajet et rend ce que chacune a dit.
   *
   * @param dto Trajet à sonder : deux extrémités, ou une recherche à rejouer
   * @param userId Identité issue du JWT vérifié — préférences et historique lus sur ce compte (C4)
   * @returns Les données brutes des trois sources, séparées et horodatées
   * @throws {NotFoundException} endpoint désactivé, ou recherche absente de cet historique
   * @throws {BadRequestException} ni extrémités ni recherche à rejouer
   */
  async testSources(dto: TestSourcesDto, userId: string): Promise<SourceDiagnosticsResponse> {
    if (!this.enabled) {
      // Volontairement indiscernable d'une route inexistante (voir la classe).
      throw new NotFoundException('Cannot POST /api/routes/sources');
    }

    const { from, to, replayedSearchHistoryId } = await this.resolveEndpoints(dto, userId);

    // Étape 3 : les préférences viennent du compte du JWT, jamais du corps. Le
    // diagnostic doit sonder les sources telles que l'usager les interroge,
    // contrainte fauteuil roulant comprise (C12).
    const preferences = await this.users.getPreferences(userId);

    // Étapes 13-18 : les trois sources en parallèle (UF-305), sans fusion.
    const collected = await this.collector.collectAllSources(from, to, {
      reducedMobility: preferences.reducedMobility,
    });

    // C11 : ni coordonnées ni libellés dans les logs. Un endpoint de diagnostic
    // ne doit pas laisser dans les journaux ce que le reste du code s'interdit.
    this.logger.log(
      `Diagnostic des sources : ${3 - collected.failures.length}/3 disponible(s) ` +
        `en ${collected.elapsedMs} ms${replayedSearchHistoryId ? ' (trajet rejoué)' : ''}.`,
    );

    return {
      collectedAt: new Date().toISOString(),
      elapsedMs: collected.elapsedMs,
      allSourcesFailed: collected.allSourcesFailed,
      query: { from, to, replayedSearchHistoryId },
      preferences: { reducedMobility: preferences.reducedMobility },
      sources: {
        transit: toDiagnostics('transit', collected.transit),
        sharedMobility: toDiagnostics('sharedMobility', collected.sharedMobility),
        cyclePaths: toDiagnostics('cyclePaths', collected.cyclePaths),
      },
    };
  }

  /**
   * Détermine les deux extrémités à sonder : celles du corps, ou celles d'une
   * recherche enregistrée (UF-204).
   *
   * L'entrée d'historique est relue **avec l'identité du JWT** : un identifiant
   * absent de l'historique de ce compte est indiscernable d'un identifiant
   * inexistant (C4 / OWASP A01). Sans cela, l'endpoint deviendrait un moyen de
   * lire les trajets d'autrui en les faisant rejouer.
   */
  private async resolveEndpoints(
    dto: TestSourcesDto,
    userId: string,
  ): Promise<{ from: RouteEndpoint; to: RouteEndpoint; replayedSearchHistoryId: string | null }> {
    if (dto.searchHistoryId) {
      const entry = await this.searchHistory.findOwnedById(userId, dto.searchHistoryId);
      if (!entry) {
        throw new NotFoundException("Cette recherche n'existe pas dans votre historique.");
      }
      return { from: entry.from, to: entry.to, replayedSearchHistoryId: entry.id };
    }

    if (!dto.from || !dto.to) {
      // La validation du DTO couvre déjà ce cas ; le service ne doit pas
      // dépendre d'un appelant correct pour rester cohérent (défense en profondeur).
      throw new BadRequestException(
        'Fournissez `from` et `to`, ou `searchHistoryId` pour rejouer une recherche enregistrée.',
      );
    }

    return { from: dto.from, to: dto.to, replayedSearchHistoryId: null };
  }
}

/**
 * Projette le résultat interne d'une source sur le contrat publié.
 *
 * La panne est recopiée **sans son champ `source`** : l'enveloppe le porte déjà,
 * et le répéter à l'intérieur inviterait les deux à diverger.
 */
function toDiagnostics<T>(source: SourceName, outcome: SourceOutcome<T>): SourceDiagnostics<T> {
  return {
    source,
    status: outcome.status,
    elapsedMs: outcome.elapsedMs,
    ...(outcome.failure && {
      failure: { kind: outcome.failure.kind, reason: outcome.failure.reason },
    }),
    data: outcome.data,
  };
}
