/**
 * Contrat de `GET /api/transport/status` (F3).
 *
 * **Remonté dans `@urbanflow/shared` par UF-804.** Il vivait jusqu'ici dans le
 * service NestJS qui le produit, ce qui suffisait tant que l'endpoint n'avait
 * aucun consommateur front. Depuis que les deux cartes temps réel de l'écran de
 * résultats l'affichent, c'est un contrat partagé comme les autres : le laisser
 * côté serveur aurait obligé le client à retaper les mêmes champs, et à
 * découvrir à l'exécution le jour où l'un d'eux change (C9).
 *
 * **À quoi il sert, exactement.** Il alimente la **ligne de provenance** des
 * deux encarts temps réel de l'écran de résultats — « GBFS · temps réel » ou
 * « GBFS · flux figé », « GTFS · horaire théorique » ou « GTFS · source
 * injoignable » (`lib/realtime-cards.ts`). Il n'alimente **pas** le bandeau
 * « mode dégradé » du planificateur : celui-ci se lit dans le champ `sources`
 * que `POST /routes/plan` rend pour **cette recherche-là**, et qui dit ce qui
 * a manqué à ce calcul précis. Les deux répondent à deux questions
 * différentes — « nos sources vont-elles bien en ce moment ? » et « qu'a-t-on
 * pu interroger pour votre trajet ? » — et les confondre ferait afficher une
 * panne générale là où une seule requête a expiré, ou l'inverse.
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
 *
 * Trois valeurs, et pas une de plus depuis UF-808. Une quatrième, `mock`,
 * datait du temps où le planificateur rendait des itinéraires simulés : plus
 * aucun code ne l'émettait, mais tout consommateur devait continuer d'en tenir
 * compte pour satisfaire le typage. Un état que rien ne peut produire n'est
 * pas une réserve, c'est une branche que personne ne saura jamais tester.
 */
export type TransportSourceHealth = 'ok' | 'degraded' | 'down';

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
