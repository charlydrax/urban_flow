import type {
  CycleSegmentsResult,
  NearbyStationsResult,
  RouteSourceName,
  TransitJourneysResult,
} from '@urbanflow/shared';

/**
 * Contrats de la collecte parallèle des sources (UF-305) — étapes 13-18 du flux
 * de référence.
 *
 * ## Pourquoi ces types vivent ici et pas dans `@urbanflow/shared`
 *
 * `@urbanflow/shared` porte les contrats **front/back** : ce que le client
 * consomme. Ce qui suit est le produit intermédiaire d'une étape interne du
 * Service Itinéraire — les données brutes des trois sources, avant fusion
 * (UF-401). Le client ne les verra jamais sous cette forme. Les publier
 * figerait un détail d'implémentation dans le contrat public, et rendrait la
 * fusion plus difficile à faire évoluer.
 *
 * Seul `SourceAvailability` franchit la frontière, parce que le client a besoin
 * de savoir quels modes ont pu être proposés (bandeau « mode dégradé » — C10) ;
 * il est donc défini dans `@urbanflow/shared`, pas ici.
 *
 * UF-306 y avait fait une exception assumée : son endpoint de diagnostic
 * publiait ces données brutes, si bien que les formes des deux extrémités
 * (`SharedMobilityEndpoints`, `CyclePathEndpoints`) vivaient dans
 * `@urbanflow/shared`. L'endpoint ayant été retiré (UF-402), **plus rien de
 * tout cela ne franchit la frontière** : ces deux types sont revenus ici, avec
 * le reste du produit de la collecte. La règle générale n'a plus d'exception.
 */

/** Les trois sources du planificateur (étape 4 du flux). */
export type SourceName = RouteSourceName;

/**
 * Comment une source a échoué.
 *
 * La distinction n'est pas cosmétique, elle sépare deux natures de problème :
 *
 * - `unavailable` : la source **a répondu** qu'elle ne pouvait pas servir
 *   (timeout amont, opérateur injoignable, HTTP 5xx). C'est le contrat de
 *   résilience de `TransitService` et `SharedMobilityService`, qui ne lèvent
 *   jamais. Situation attendue, à journaliser sans alarmisme.
 * - `error` : la source a **levé une exception**. Personne ne l'avait prévu —
 *   bug de mapping, géométrie corrompue en base, panne PostGIS. C'est ce que
 *   `Promise.allSettled` rattrape, et c'est le seul cas qui mérite un log
 *   d'erreur.
 * - `timeout` : la source a dépassé le budget de la collecte elle-même, sans
 *   s'être arrêtée d'elle-même. Un seul cas réel aujourd'hui : PostGIS, qui
 *   n'a pas de délai propre.
 */
export type SourceFailureKind = 'unavailable' | 'error' | 'timeout';

/** Ce qu'on retient d'une source qui n'a rien pu fournir (C10, journalisation). */
export interface SourceFailure {
  source: SourceName;
  kind: SourceFailureKind;
  /**
   * Cause lisible, destinée aux logs et au diagnostic.
   *
   * RGPD (C11) : jamais de coordonnées ni de libellé de lieu ici — une cause de
   * panne n'a pas besoin de savoir où allait l'usager.
   */
  reason: string;
}

/**
 * Résultat d'une source, avec le temps qu'elle a mis.
 *
 * `elapsedMs` n'est pas de la décoration : c'est la preuve du parallélisme
 * (recettes 1 et 4 du ticket). Si la collecte dure à peu près le temps de la
 * source la plus lente, les appels sont bien concurrents ; si elle dure la
 * somme des trois, ils sont en cascade.
 */
export interface SourceOutcome<T> {
  status: 'ok' | 'failed';
  /** Données brutes de la source, `null` si elle a échoué. */
  data: T | null;
  /** Renseigné uniquement quand `status` vaut `'failed'`. */
  failure?: SourceFailure;
  /** Temps écoulé pour cette source, en millisecondes. */
  elapsedMs: number;
}

/**
 * Stations en libre-service aux **deux extrémités** du trajet.
 *
 * Une seule extrémité ne suffirait pas : un trajet en vélo partagé suppose une
 * borne pour en prendre un **et** une borne pour le rendre. Interroger les deux
 * ici plutôt qu'au moment de la fusion évite un second aller-retour réseau une
 * fois la collecte terminée — les deux requêtes partent ensemble et ne coûtent
 * qu'une latence (C5/C10).
 *
 * Ce fut un alias d'un type publié par `@urbanflow/shared` tant que le
 * diagnostic UF-306 exposait les données brutes ; l'endpoint retiré (UF-402),
 * la forme est redevenue interne et se décrit ici, à un seul endroit.
 */
export interface SharedMobilityEndpoints {
  origin: NearbyStationsResult;
  destination: NearbyStationsResult;
}

/** Tronçons cyclables aux deux extrémités, pour la même raison. */
export interface CyclePathEndpoints {
  origin: CycleSegmentsResult;
  destination: CycleSegmentsResult;
}

/**
 * Données brutes des trois sources, prêtes pour la fusion (UF-401).
 *
 * Aucune fusion, aucun tri, aucun calcul carbone à ce stade : la collecte
 * rapporte ce que les sources ont dit, et rien de plus. C'est ce qui permet de
 * la tester — et de la présenter en soutenance — indépendamment de la
 * construction des itinéraires.
 */
export interface CollectedSources {
  transit: SourceOutcome<TransitJourneysResult>;
  sharedMobility: SourceOutcome<SharedMobilityEndpoints>;
  cyclePaths: SourceOutcome<CyclePathEndpoints>;

  /** Les sources qui n'ont rien pu fournir, dans l'ordre des sources. */
  failures: SourceFailure[];

  /**
   * `true` quand **aucune** des trois sources n'a répondu.
   *
   * Recette 3 du ticket : ce cas doit remonter un état clair et non une
   * exception. Le distinguer explicitement évite que l'appelant ait à
   * recompter les échecs pour savoir s'il lui reste quelque chose à fusionner.
   */
  allSourcesFailed: boolean;

  /**
   * Durée totale de la collecte, en millisecondes.
   *
   * À comparer au `elapsedMs` le plus élevé des trois sources : l'écart est le
   * coût de l'orchestration elle-même, et il doit rester négligeable (C10).
   */
  elapsedMs: number;
}
