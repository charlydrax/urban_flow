/**
 * Contrats et paramètres RGPD (UF-603, C8/C11) — partagés front/back.
 *
 * Les durées de conservation vivent **ici** et nulle part ailleurs : c'est le
 * seul moyen de garantir que la politique de confidentialité affichée à
 * l'utilisateur annonce exactement le délai que la purge applique en base. Deux
 * constantes séparées dériveraient tôt ou tard, et une politique qui ment sur sa
 * propre rétention est un manquement, pas une coquille.
 */

/**
 * Durée de conservation de l'historique de déplacements, en jours (C8 —
 * limitation de la conservation, art. 5.1.e RGPD).
 *
 * 12 mois : c'est la plus courte durée qui laisse encore un sens au tableau de
 * bord carbone personnel, dont l'unité de lecture est le mois et la comparaison
 * naturelle l'année écoulée. En dessous, la fonctionnalité perd son objet ; au
 * dessus, on conserverait des trajets que plus personne ne consulte.
 *
 * Appliquée par `DataRetentionService` côté API (purge quotidienne), annoncée
 * telle quelle sur la page « Politique de confidentialité » côté PWA.
 */
export const SEARCH_HISTORY_RETENTION_DAYS = 365;

/** La même durée en mois, pour les textes destinés aux utilisateurs. */
export const SEARCH_HISTORY_RETENTION_MONTHS = 12;

/**
 * Résultat de `DELETE /api/users/me` — droit à l'effacement (art. 17 RGPD, C8).
 *
 * L'API rend le **décompte de ce qui a réellement disparu** plutôt qu'un simple
 * 204 : l'utilisateur qui exerce son droit à l'effacement a droit à une preuve
 * d'exécution, et l'écran de confirmation l'affiche. C'est aussi ce qui rend la
 * recette du ticket vérifiable sans ouvrir la base.
 */
export interface DeleteAccountResult {
  /** Identifiant du compte effacé — utile en trace d'audit côté client. */
  deletedUserId: string;
  /** Nombre de lignes d'historique de déplacements supprimées avec le compte. */
  deletedSearchHistoryCount: number;
  /** `true` si un profil de mobilité (dont la donnée PMR) existait et a été effacé. */
  deletedMobilityProfile: boolean;
  /** Horodatage ISO 8601 de l'effacement, tel qu'observé par le serveur. */
  deletedAt: string;
}
