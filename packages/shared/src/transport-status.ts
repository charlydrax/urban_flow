/**
 * Contrat de `GET /api/transport/status` (F3 — UF-306).
 *
 * **Remonté dans `@urbanflow/shared` par UF-804.** Il vivait jusqu'ici dans le
 * service NestJS qui le produit, ce qui suffisait tant que l'endpoint n'avait
 * aucun consommateur front. Depuis que les deux cartes temps réel de l'écran de
 * résultats l'affichent, c'est un contrat partagé comme les autres : le laisser
 * côté serveur aurait obligé le client à retaper les mêmes champs, et à
 * découvrir à l'exécution le jour où l'un d'eux change (C9).
 */

/** Source de données transport interrogée par le diagnostic. */
export type TransportSourceName =
  /** Transports en commun — moteur OpenTripPlanner alimenté par le GTFS TCL. */
  | 'gtfs'
  /** Véhicules en libre-service — flux GBFS de l'opérateur. */
  | 'gbfs';

/**
 * État constaté d'une source.
 *
 * `degraded` n'est pas une demi-panne : la source répond, mais sa donnée n'est
 * plus fraîche (un flux GBFS figé depuis un quart d'heure). La distinguer de
 * `down` est ce qui permet d'afficher un nombre de vélos **en le nuançant**,
 * plutôt que de le cacher ou de le donner pour argent comptant (C10).
 */
export type TransportSourceHealth = 'ok' | 'degraded' | 'down' | 'mock';

/** État de disponibilité d'une source de données transport. */
export interface TransportSourceStatus {
  source: TransportSourceName;
  status: TransportSourceHealth;
  /** Horodatage de la vérification (ISO 8601) — pas celui de la donnée. */
  checkedAt: string;
  /**
   * Précision lisible sur l'état constaté : période GTFS couverte, fraîcheur du
   * flux, ou cause de la panne.
   *
   * Volontairement rédigée côté serveur : c'est lui qui sait ce qu'il a sondé,
   * et le client n'a pas à recomposer une phrase à partir de champs techniques
   * qu'il interpréterait à sa façon.
   */
  detail?: string;
}
