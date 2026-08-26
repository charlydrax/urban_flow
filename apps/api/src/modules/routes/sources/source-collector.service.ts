import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CycleSegmentsResult,
  NearbyStationsResult,
  SourceAvailability,
  TransitJourneysResult,
} from '@urbanflow/shared';

import { CyclePathsService } from '../../transport/cycle-paths/cycle-paths.service';
import { SharedMobilityService } from '../../transport/shared-mobility.service';
import { TransitService } from '../../transport/transit.service';
import type {
  CollectedSources,
  CyclePathEndpoints,
  SharedMobilityEndpoints,
  SourceFailure,
  SourceName,
  SourceOutcome,
} from './collected-sources';

/** Extrémité d'une recherche : les coordonnées sont obligatoires ici. */
export interface RouteEndpoint {
  label: string;
  lat: number;
  lng: number;
}

/** Ce que la collecte retient des préférences du compte (étape 3 du flux). */
export interface CollectPreferences {
  /** Ne retenir que les trajets praticables en fauteuil roulant (C12). */
  reducedMobility: boolean;
}

/**
 * Marge accordée à la collecte au-delà du délai propre de la source la plus
 * lente, en millisecondes.
 *
 * Le budget de collecte n'est **pas** un second timeout empilé sur ceux des
 * connecteurs : le calculer à partir d'`OTP_TIMEOUT_MS` garantit qu'il ne
 * préempte jamais le délai d'OpenTripPlanner — sinon la source serait coupée
 * avant d'avoir pu qualifier sa propre panne, et le diagnostic (`timeout` /
 * `network` / `upstream-error`) serait perdu.
 *
 * Il n'existe que pour la source qui n'a aucun délai à elle : **PostGIS**. Une
 * requête bloquée sur un verrou immobiliserait sinon la requête de l'usager
 * indéfiniment, ce qui est précisément ce que C10 interdit.
 */
const COLLECTION_BUDGET_MARGIN_MS = 2000;

/**
 * Rayon de recherche des bornes en libre-service pour la planification, en
 * mètres.
 *
 * Plus large que le défaut du connecteur (500 m, « les stations autour de
 * moi ») parce que la fusion (UF-401) ne cherche pas seulement une borne près
 * de l'usager : il lui en faut aussi une près de l'**arrêt d'embarquement**
 * pour construire un rabattement vélo → transports en commun. Un arrêt à sept
 * cents mètres tomberait hors du rayon par défaut, et le rabattement — la
 * proposition la plus intéressante du planificateur — ne serait jamais
 * constructible.
 *
 * Le surcoût est nul côté réseau (C5) : le connecteur GBFS télécharge et
 * mémoïse les flux **entiers**, puis filtre en mémoire. Élargir le rayon ne
 * déclenche aucune requête supplémentaire, seulement quelques haversines de
 * plus.
 */
const PLANNING_STATION_RADIUS_METERS = 900;

/**
 * Nombre de bornes retenues par extrémité pour la planification.
 *
 * Relevé en conséquence du rayon : avec la limite par défaut (10), les dix
 * bornes les plus proches de l'usager satureraient la liste et masqueraient
 * celle qui dessert l'arrêt, qui est justement celle qu'on cherche.
 */
const PLANNING_STATION_LIMIT = 20;

/** Sentinelle interne : une source qui a dépassé le budget de la collecte. */
const BUDGET_EXCEEDED = Symbol('source-budget-exceeded');

/**
 * Collecteur des sources du planificateur (UF-305) — étapes 13-18 du flux de
 * référence, et la traduction directe de la contrainte C10.
 *
 * ## Ce qu'il fait, et ce qu'il ne fait pas
 *
 * Il lance les **trois** sources en parallèle, attend la plus lente, et rend ce
 * que chacune a dit. Il ne fusionne rien, ne trie rien, ne calcule aucun CO₂ :
 * la construction des itinéraires multimodaux est l'affaire de la fusion
 * (`merge/itinerary-merger.ts`, UF-401). Cette
 * séparation est délibérée — l'orchestration et la fusion échouent pour des
 * raisons différentes, et les mêler rendrait les deux plus difficiles à tester.
 *
 * ## Pourquoi `allSettled` et pas `all`
 *
 * `Promise.all` rejette dès le premier échec **et abandonne les autres
 * résultats** : une panne de l'opérateur de vélos ferait perdre les trajets en
 * métro déjà calculés. C'est exactement le contraire de la dégradation
 * gracieuse attendue. `Promise.allSettled` attend les trois quoi qu'il arrive,
 * et laisse trier ensuite.
 *
 * ## `allSettled` ne suffit pourtant pas
 *
 * `TransitService` et `SharedMobilityService` ne **lèvent jamais** à cause de
 * leur source : ils rendent un résultat `status: 'unavailable'`. Du point de vue
 * de `Promise.allSettled`, ces appels sont donc `fulfilled` — réussis. Une
 * orchestration qui ne regarderait que `settled.status` conclurait que tout va
 * bien alors qu'aucun trajet n'a été trouvé.
 *
 * Une source est ici considérée en échec dans **trois** cas, pas un seul :
 * elle a levé (`error`), elle a poliment déclaré forfait (`unavailable`), ou
 * elle a dépassé le budget sans rien dire (`timeout`).
 *
 * Couvre : F2, C5 (une seule latence au lieu de trois), C10 (appels
 * parallèles, budget borné, dégradation gracieuse), C11 (les logs nomment la
 * source et la cause, jamais le trajet), C12 (préférence PMR propagée à OTP).
 */
@Injectable()
export class SourceCollectorService {
  private readonly logger = new Logger(SourceCollectorService.name);

  /** Budget accordé à chaque source, dérivé du délai d'OTP (voir la constante). */
  private readonly budgetMs: number;

  constructor(
    private readonly transit: TransitService,
    private readonly sharedMobility: SharedMobilityService,
    private readonly cyclePaths: CyclePathsService,
    config: ConfigService,
  ) {
    this.budgetMs = config.getOrThrow<number>('OTP_TIMEOUT_MS') + COLLECTION_BUDGET_MARGIN_MS;
  }

  /**
   * Interroge les trois sources en parallèle et rapporte ce que chacune a dit.
   *
   * **Ne lève jamais à cause d'une source** : c'est le contrat du ticket
   * (recette 3). Même les trois sources en panne donnent un résultat
   * exploitable, avec `allSourcesFailed: true` — un appelant qui reçoit ce
   * drapeau sait qu'il n'a rien à fusionner, sans avoir à interpréter une
   * exception.
   *
   * @param from Départ, coordonnées obligatoires (le géocodage est fait en amont — UF-203)
   * @param to Arrivée, coordonnées obligatoires
   * @param prefs Préférences du compte, lues en base à l'étape 3 du flux
   * @returns Les données brutes des trois sources, prêtes pour la fusion (UF-401)
   */
  async collectAllSources(
    from: RouteEndpoint,
    to: RouteEndpoint,
    prefs: CollectPreferences,
  ): Promise<CollectedSources> {
    const startedAt = Date.now();

    // Les trois appels partent AVANT le premier `await` : c'est ce qui les rend
    // concurrents. Les confier chacun à `timed()` mesure la source elle-même,
    // sans compter l'attente des deux autres.
    const settled = await Promise.allSettled([
      this.timed('transit', () => this.fetchTransit(from, to, prefs)),
      this.timed('sharedMobility', () => this.fetchSharedMobility(from, to)),
      this.timed('cyclePaths', () => this.fetchCyclePaths(from, to)),
    ]);

    const transit = toOutcome<TransitJourneysResult>('transit', settled[0], isTransitUsable);
    const sharedMobility = toOutcome<SharedMobilityEndpoints>(
      'sharedMobility',
      settled[1],
      isSharedMobilityUsable,
    );
    const cyclePaths = toOutcome<CyclePathEndpoints>('cyclePaths', settled[2], () => true);

    const failures = [transit, sharedMobility, cyclePaths]
      .map((outcome) => outcome.failure)
      .filter((failure): failure is SourceFailure => failure !== undefined);

    const collected: CollectedSources = {
      transit,
      sharedMobility,
      cyclePaths,
      failures,
      allSourcesFailed: failures.length === 3,
      elapsedMs: Date.now() - startedAt,
    };

    this.report(collected);
    return collected;
  }

  /**
   * Traduit la collecte en état public des sources, pour la réponse au client.
   *
   * La cause exacte reste dans les logs : le client apprend qu'un mode n'a pas
   * pu être proposé, pas quel composant de notre infrastructure a lâché (C11).
   *
   * @param collected Résultat de `collectAllSources`
   * @returns Un état par source, dans l'ordre du flux de référence
   */
  toAvailability(collected: CollectedSources): SourceAvailability[] {
    return (
      [
        ['transit', collected.transit] as const,
        ['sharedMobility', collected.sharedMobility] as const,
        ['cyclePaths', collected.cyclePaths] as const,
      ] satisfies readonly (readonly [SourceName, SourceOutcome<unknown>])[]
    ).map(([source, outcome]) =>
      outcome.status === 'ok'
        ? { source, available: true }
        : { source, available: false, reason: toPublicReason(outcome.failure) },
    );
  }

  // --------------------------------------------------------------- les sources

  /** Trajets en transports en commun (GTFS via OpenTripPlanner — UF-302). */
  private fetchTransit(
    from: RouteEndpoint,
    to: RouteEndpoint,
    prefs: CollectPreferences,
  ): Promise<TransitJourneysResult> {
    return this.transit.getTransitJourneys(from, to, {
      // C12 : la préférence PMR du profil devient une contrainte de calcul, pas
      // un filtre appliqué après coup sur des trajets impraticables.
      wheelchair: prefs.reducedMobility,
    });
  }

  /**
   * Stations en libre-service aux deux extrémités (GBFS — UF-303).
   *
   * Les deux requêtes partent ensemble : un trajet en vélo partagé suppose une
   * borne au départ **et** une borne à l'arrivée, et les enchaîner ajouterait
   * une latence réseau à la recherche de l'usager pour rien (C5/C10).
   *
   * Le rayon et le nombre de bornes sont ceux de la **planification**, plus
   * larges que les valeurs par défaut du connecteur : voir
   * `PLANNING_STATION_RADIUS_METERS`.
   */
  private async fetchSharedMobility(
    from: RouteEndpoint,
    to: RouteEndpoint,
  ): Promise<SharedMobilityEndpoints> {
    const options = {
      radiusMeters: PLANNING_STATION_RADIUS_METERS,
      limit: PLANNING_STATION_LIMIT,
    };

    const [origin, destination] = await Promise.all([
      this.sharedMobility.getNearbyStations(from, options),
      this.sharedMobility.getNearbyStations(to, options),
    ]);
    return { origin, destination };
  }

  /** Tronçons cyclables aux deux extrémités (PostGIS `ST_DWithin` — UF-304). */
  private async fetchCyclePaths(
    from: RouteEndpoint,
    to: RouteEndpoint,
  ): Promise<CyclePathEndpoints> {
    const [origin, destination] = await Promise.all([
      this.cyclePaths.getCycleSegments(from),
      this.cyclePaths.getCycleSegments(to),
    ]);
    return { origin, destination };
  }

  // --------------------------------------------------------------- mécanique

  /**
   * Exécute une source sous budget, en mesurant sa durée.
   *
   * Le budget ne remplace pas les délais des connecteurs (voir
   * `COLLECTION_BUDGET_MARGIN_MS`) : il rattrape la seule source qui n'en a pas.
   * Une source dépassée rend la sentinelle `BUDGET_EXCEEDED` plutôt que de
   * lever, pour que « trop lente » et « en erreur » restent deux échecs
   * distincts dans les logs.
   *
   * ⚠️ Le `setTimeout` est libéré dans `finally` : sans cela, une collecte
   * rapide laisserait trois minuteries actives, et le processus Node refuserait
   * de se terminer tant qu'elles courent.
   */
  private async timed<T>(
    source: SourceName,
    run: () => Promise<T>,
  ): Promise<{ source: SourceName; value: T | typeof BUDGET_EXCEEDED; elapsedMs: number }> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;

    try {
      const value = await Promise.race([
        run(),
        new Promise<typeof BUDGET_EXCEEDED>((resolve) => {
          timer = setTimeout(() => resolve(BUDGET_EXCEEDED), this.budgetMs);
        }),
      ]);
      return { source, value, elapsedMs: Date.now() - startedAt };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Journalise le déroulement de la collecte.
   *
   * Les durées par source sont tracées à chaque recherche, et pas seulement en
   * cas de panne : c'est la preuve du parallélisme demandée par les recettes 1
   * et 4 du ticket, et elle doit être lisible en production, pas seulement dans
   * un test.
   *
   * RGPD (C11) : ni coordonnées, ni libellés de lieux — une ligne de log ne doit
   * pas raconter où va l'usager. Seuls le nom de la source, sa durée et la cause
   * de son échec y figurent.
   */
  private report(collected: CollectedSources): void {
    const { transit, sharedMobility, cyclePaths, elapsedMs, failures } = collected;
    const slowest = Math.max(transit.elapsedMs, sharedMobility.elapsedMs, cyclePaths.elapsedMs);

    this.logger.log(
      `Collecte des sources en ${elapsedMs} ms ` +
        `(transit ${transit.elapsedMs} ms, sharedMobility ${sharedMobility.elapsedMs} ms, ` +
        `cyclePaths ${cyclePaths.elapsedMs} ms ; la plus lente : ${slowest} ms) — ` +
        `${3 - failures.length}/3 source(s) disponible(s).`,
    );

    for (const failure of failures) {
      const message = `Source ${failure.source} indisponible (${failure.kind}) : ${failure.reason}`;
      // Une panne amont est attendue et se gère ; une exception ne l'est pas et
      // mérite d'être vue comme telle dans la supervision.
      if (failure.kind === 'error') this.logger.error(message);
      else this.logger.warn(message);
    }

    if (collected.allSourcesFailed) {
      // Pas une exception : l'appelant doit pouvoir répondre proprement
      // « aucune option cette fois » (recette 3).
      this.logger.error('Les trois sources ont échoué : aucune option ne peut être construite.');
    }
  }
}

/**
 * Projette un résultat `Promise.allSettled` sur un `SourceOutcome`.
 *
 * `isUsable` est ce qui distingue cette fonction d'un simple test sur
 * `settled.status` : une source peut être `fulfilled` tout en ayant déclaré son
 * indisponibilité dans sa charge utile. C'est le cas nominal de `TransitService`
 * et `SharedMobilityService`, qui ne lèvent jamais à cause de leur source.
 */
function toOutcome<T>(
  source: SourceName,
  settled: PromiseSettledResult<{
    source: SourceName;
    value: unknown;
    elapsedMs: number;
  }>,
  isUsable: (value: T) => boolean,
): SourceOutcome<T> {
  if (settled.status === 'rejected') {
    // La source a levé : `elapsedMs` est inconnu (la mesure vivait dans la
    // promesse rejetée). Le rapporter à 0 serait un mensonge lisible ; on
    // rapporte donc 0 en l'assumant comme « non mesuré ».
    return {
      status: 'failed',
      data: null,
      elapsedMs: 0,
      failure: { source, kind: 'error', reason: describeError(settled.reason) },
    };
  }

  const { value, elapsedMs } = settled.value;

  if (value === BUDGET_EXCEEDED) {
    return {
      status: 'failed',
      data: null,
      elapsedMs,
      failure: {
        source,
        kind: 'timeout',
        reason: 'budget de collecte dépassé sans réponse ni délai propre à la source',
      },
    };
  }

  const data = value as T;
  if (!isUsable(data)) {
    return {
      status: 'failed',
      data: null,
      elapsedMs,
      failure: { source, kind: 'unavailable', reason: describeUnavailable(data) },
    };
  }

  return { status: 'ok', data, elapsedMs };
}

/**
 * Un résultat TC est exploitable dès lors que le moteur a répondu.
 *
 * ⚠️ `journeys: []` avec `status: 'ok'` n'est **pas** un échec : cela veut dire
 * « le moteur a cherché et n'a rien trouvé », ce qui est une réponse. La traiter
 * comme une panne ferait afficher « transports en commun indisponibles » à un
 * usager qui habite simplement hors du réseau.
 */
function isTransitUsable(result: TransitJourneysResult): boolean {
  return result.status === 'ok';
}

/**
 * Les mobilités douces sont exploitables si **au moins une** extrémité a
 * répondu.
 *
 * Exiger les deux serait trop strict : des stations connues au départ
 * permettent déjà de proposer un rabattement vers un arrêt, même si l'arrivée
 * n'a rien renvoyé. Les deux appels visant le même flux, une extrémité en panne
 * et l'autre non traduit en pratique une coupure passagère.
 */
function isSharedMobilityUsable(endpoints: SharedMobilityEndpoints): boolean {
  return endpoints.origin.status === 'ok' || endpoints.destination.status === 'ok';
}

/** Résume une panne déclarée par une source, pour les logs (C11 : rien de personnel). */
function describeUnavailable(data: unknown): string {
  const result = data as Partial<TransitJourneysResult & NearbyStationsResult>;
  if (typeof result?.unavailableReason === 'string') return result.unavailableReason;

  const endpoints = data as Partial<SharedMobilityEndpoints & CyclePathEndpoints>;
  const origin = endpoints?.origin as Partial<NearbyStationsResult & CycleSegmentsResult>;
  const destination = endpoints?.destination as Partial<NearbyStationsResult & CycleSegmentsResult>;
  const reasons = [origin?.unavailableReason, destination?.unavailableReason].filter(Boolean);
  if (reasons.length > 0) return reasons.join(' / ');

  return 'source indisponible';
}

/** Message d'une exception, sans jamais propager la pile jusqu'au contrat (C11). */
function describeError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Traduit une cause interne en cause publiable.
 *
 * Le vocabulaire est volontairement pauvre : le client a besoin de nuancer son
 * message, pas de connaître notre topologie. Un `upstream-error` par défaut vaut
 * mieux qu'un détail technique qui fuirait dans une réponse HTTP (C11).
 */
function toPublicReason(failure: SourceFailure | undefined): SourceAvailability['reason'] {
  if (!failure) return 'upstream-error';
  if (failure.kind === 'error') return 'internal-error';
  if (failure.kind === 'timeout' || failure.reason.includes('timeout')) return 'timeout';
  if (failure.reason.includes('network')) return 'network';
  return 'upstream-error';
}
