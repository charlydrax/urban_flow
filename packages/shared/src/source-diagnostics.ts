import type { CycleSegmentsResult } from './cycle-path';
import type { RouteSourceName } from './route';
import type { SearchHistoryPlace } from './search-history';
import type { NearbyStationsResult } from './shared-mobility';
import type { TransitJourneysResult } from './transit';

/**
 * Contrats de l'endpoint interne de test des sources (UF-306) —
 * `POST /api/routes/sources`.
 *
 * ## Pourquoi ces types traversent la frontière front/back
 *
 * `collected-sources.ts` (côté API) explique pourquoi le produit de la collecte
 * reste **interne** : c'est une étape du planificateur, pas un contrat public,
 * et le figer empêcherait la fusion du Sprint 4 d'évoluer. UF-306 fait
 * délibérément l'exception : il **publie** ces données brutes, parce que c'est
 * précisément son objet — vérifier de bout en bout, œil humain compris, que les
 * trois sources répondent avant de construire quoi que ce soit par-dessus.
 *
 * ⚠️ **Contrat temporaire.** Il disparaîtra avec l'endpoint au Sprint 4, quand
 * `POST /api/routes/plan` rendra de vrais itinéraires fusionnés. Rien de
 * durable ne doit s'appuyer dessus : le seul consommateur prévu est l'écran de
 * diagnostic `/dev/sources`.
 *
 * ## Ce qu'il expose, et pourquoi ce n'est pas contradictoire avec C11
 *
 * À la différence de `SourceAvailability` — dont le vocabulaire est
 * volontairement pauvre pour ne rien dire de notre topologie —, la réponse porte
 * ici la **cause technique réelle** de chaque panne. C'est ce qui rend le
 * diagnostic utile, et c'est aussi ce qui rend l'endpoint impubliable en
 * production : il est désactivé par défaut hors développement (voir
 * `SourceDiagnosticsService`).
 */

/**
 * Extrémité d'une recherche de diagnostic.
 *
 * Les coordonnées ne sont **pas** facultatives, contrairement à `Place` : les
 * trois sources travaillent sur des points, et le géocodage est fait par le
 * client (UF-203). Même forme que `SearchHistoryPlace`, pour qu'une entrée
 * d'historique se rejoue sans conversion.
 */
export type SourceDiagnosticsPlace = SearchHistoryPlace;

/**
 * Corps de `POST /api/routes/sources`.
 *
 * Deux façons de désigner le trajet à sonder, exclusives dans les faits :
 * saisir les deux extrémités, ou rejouer une recherche déjà enregistrée
 * (UF-204). La seconde évite de retaper des coordonnées à la main à chaque
 * vérification — et sonde exactement le trajet que l'usager a réellement
 * demandé, ce qu'une saisie approximative ne reproduit pas.
 */
export interface SourceDiagnosticsRequest {
  /** Départ — requis, sauf si `searchHistoryId` est fourni. */
  from?: SourceDiagnosticsPlace;
  /** Arrivée — requise, sauf si `searchHistoryId` est fourni. */
  to?: SourceDiagnosticsPlace;
  /**
   * Recherche enregistrée à rejouer (UF-204).
   *
   * Elle est relue **dans l'historique du compte du JWT** : un identifiant
   * appartenant à quelqu'un d'autre donne un `404`, jamais les données visées
   * (C4 / OWASP A01).
   */
  searchHistoryId?: string;
}

/** Comment une source a échoué — vocabulaire interne, publié ici pour le diagnostic. */
export interface SourceDiagnosticsFailure {
  /**
   * - `unavailable` : la source a répondu qu'elle ne pouvait pas servir
   * - `error` : la source a levé une exception (bug, base injoignable)
   * - `timeout` : rien rendu dans le budget de la collecte
   */
  kind: 'unavailable' | 'error' | 'timeout';
  /** Cause technique lisible — jamais de coordonnées ni de libellé de lieu (C11). */
  reason: string;
}

/**
 * Ce qu'une source a rendu, isolément des deux autres.
 *
 * Recette 3 du ticket : chaque source est identifiable **séparément**. D'où un
 * objet par source plutôt qu'un tableau fusionné — une panne GBFS ne doit pas
 * se lire en creux dans l'absence d'une ligne.
 */
export interface SourceDiagnostics<TData> {
  /** `transit` (GTFS), `sharedMobility` (GBFS) ou `cyclePaths` (PostGIS). */
  source: RouteSourceName;
  status: 'ok' | 'failed';
  /** Temps mis par cette source seule — la preuve du parallélisme (C10). */
  elapsedMs: number;
  /** Renseigné uniquement quand `status` vaut `'failed'`. */
  failure?: SourceDiagnosticsFailure;
  /** Données brutes de la source, telles que son connecteur les a rendues. */
  data: TData | null;
}

/**
 * Stations en libre-service aux deux extrémités du trajet.
 *
 * Un trajet en vélo partagé suppose une borne pour en prendre un **et** une
 * borne pour le rendre : interroger une seule extrémité ne dirait rien de la
 * faisabilité du trajet.
 */
export interface SharedMobilityEndpointsData {
  origin: NearbyStationsResult;
  destination: NearbyStationsResult;
}

/** Tronçons cyclables aux deux extrémités, pour la même raison. */
export interface CyclePathEndpointsData {
  origin: CycleSegmentsResult;
  destination: CycleSegmentsResult;
}

/** Le trajet réellement sondé, et d'où viennent ses extrémités. */
export interface SourceDiagnosticsQuery {
  from: SourceDiagnosticsPlace;
  to: SourceDiagnosticsPlace;
  /**
   * Identifiant de l'entrée d'historique rejouée, `null` pour une saisie directe.
   *
   * Publié parce qu'il lève une ambiguïté à la lecture : deux diagnostics au
   * même trajet ne se comparent que s'ils partent du même point de départ, à la
   * décimale près.
   */
  replayedSearchHistoryId: string | null;
}

/**
 * Réponse de `POST /api/routes/sources` — les trois sources, brutes et séparées.
 *
 * Aucune fusion, aucun tri, aucun calcul carbone : c'est exactement ce que
 * `collectAllSources` a obtenu, mis en forme. Le Sprint 4 construira les
 * itinéraires par-dessus ces mêmes données.
 */
export interface SourceDiagnosticsResponse {
  /** Instant de la collecte (ISO 8601 — C9). */
  collectedAt: string;
  /**
   * Durée totale de la collecte, en millisecondes.
   *
   * À comparer au plus grand des trois `elapsedMs` : si les deux se ressemblent,
   * les appels sont bien parallèles ; si le total vaut leur somme, ils sont en
   * cascade (C10).
   */
  elapsedMs: number;
  /** `true` quand aucune des trois sources n'a répondu — réponse valide malgré tout. */
  allSourcesFailed: boolean;
  query: SourceDiagnosticsQuery;
  /**
   * Préférences appliquées à la collecte, lues sur le compte du JWT (étape 3).
   *
   * Exposées parce qu'elles changent le résultat sans être visibles dans la
   * requête : un diagnostic sans trajet TC s'explique tout autrement selon que
   * la contrainte fauteuil roulant était active ou non (C12).
   */
  preferences: { reducedMobility: boolean };
  sources: {
    transit: SourceDiagnostics<TransitJourneysResult>;
    sharedMobility: SourceDiagnostics<SharedMobilityEndpointsData>;
    cyclePaths: SourceDiagnostics<CyclePathEndpointsData>;
  };
}
