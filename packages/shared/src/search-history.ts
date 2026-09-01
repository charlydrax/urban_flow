import { TransportMode } from './transport-mode';

/**
 * Contrats de l'historique de recherche (UF-204) — `GET /api/search-history` et
 * les deux écritures qui complètent une ligne (`/selection`, `/completion`).
 * Source de vérité unique du contrat front/back (C9) : les DTO NestJS
 * l'implémentent, le client de la PWA le consomme.
 */

/**
 * Extrémité d'un trajet enregistré.
 *
 * Contrairement à `Place` (planificateur), les coordonnées ne sont **pas**
 * facultatives : une ligne d'historique est stockée en géométrie PostGIS, et un
 * trajet sans point ne serait ni rejouable ni cartographiable. Le front n'envoie
 * donc à l'historique que des adresses réellement géocodées (UF-203).
 */
export interface SearchHistoryPlace {
  label: string;
  lat: number;
  lng: number;
}

/** Une recherche enregistrée, telle que relue par l'API. */
export interface SearchHistoryEntry {
  id: string;
  from: SearchHistoryPlace;
  to: SearchHistoryPlace;
  selectedSummary: string | null;
  carbonGrams: number | null;
  /**
   * Référence voiture du trajet retenu, en grammes de CO₂ (UF-505).
   *
   * `null` tant qu'aucune option n'a été choisie, exactement comme
   * `carbonGrams`. Stockée **à côté** de l'empreinte plutôt que recalculée à la
   * lecture : le barème est appelé à s'affiner, et un bilan personnel dont les
   * chiffres passés changeraient à chaque mise à jour du barème ne serait pas
   * un historique.
   */
  carEquivalentGrams: number | null;
  /** Horodatage ISO 8601 de la recherche (C9). */
  createdAt: string;
  /**
   * Horodatage ISO 8601 de l'**arrivée**, `null` tant que le trajet n'a pas été
   * mené à son terme (UF-807).
   *
   * Distinct de `selectedSummary`/`carbonGrams`, qui disent l'option retenue :
   * retenir n'est pas parcourir, et seul ce champ fait entrer un trajet dans le
   * suivi carbone. Posé par `POST /api/search-history/:id/completion`, à
   * l'arrivée du guidage (UF-806).
   */
  completedAt: string | null;
}

/**
 * Segment de l'itinéraire retenu, tel que le client le renvoie pour le faire
 * valoriser (`PATCH /api/search-history/:id/selection` — UF-505).
 *
 * Volontairement réduit au **mode et à la distance** : ce sont les deux seules
 * variables du barème. Renvoyer l'itinéraire entier ferait transiter des
 * tracés GeoJSON dont le serveur n'a rien à faire ici (C5).
 */
export interface SelectedSegmentPayload {
  mode: TransportMode;
  distanceMeters: number;
}

/**
 * Corps de `PATCH /api/search-history/:id/selection` — l'option que l'usager a
 * retenue dans la liste de résultats (UF-505).
 *
 * ⚠️ **Aucune empreinte n'est envoyée par le client.** Il transmet les
 * segments ; le Service Carbone les valorise côté serveur, comme il le fait
 * déjà à l'étape 6 du flux. C'est la même règle que pour l'identité : ce qui
 * fait autorité ne vient jamais du navigateur. Un client qui pourrait poster
 * « 0 g » se fabriquerait un bilan flatteur — et un bilan qu'on peut se
 * fabriquer ne sert plus à rien, même sans autre victime que soi-même.
 */
export interface SelectItineraryPayload {
  /** Résumé lisible de l'option retenue (ex. « Marche + Métro B »). */
  selectedSummary: string;
  /** Segments de l'option retenue, dans l'ordre du trajet. */
  segments: SelectedSegmentPayload[];
}

/**
 * Corps de `POST /api/search-history/:id/completion` — le trajet que l'usager a
 * effectivement **parcouru**, tel que le guidage vient de le mener à son terme
 * (UF-807).
 *
 * Même forme que la sélection, et volontairement : l'arrivée valorise le trajet
 * réalisé **et** le marque réalisé, en un seul appel. Deux raisons à cela.
 *
 * D'abord la première option de la liste est présélectionnée sans clic : un
 * usager qui démarre le guidage dessus et arrive n'a jamais émis de sélection,
 * et son trajet — bien réel — n'aurait rien à valoriser. Ensuite deux appels
 * (valoriser, puis marquer) ouvriraient une fenêtre où un trajet serait réalisé
 * sans empreinte, c'est-à-dire compté pour zéro gramme.
 *
 * Comme pour la sélection, **aucun gramme ne vient du client** : les segments
 * sont valorisés par le Service Carbone.
 */
export type CompleteTripPayload = SelectItineraryPayload;

/** Réponse de `GET /api/search-history` — les N dernières recherches du compte connecté. */
export interface SearchHistoryList {
  entries: SearchHistoryEntry[];
}

/**
 * Nombre de recherches récentes servies par défaut.
 *
 * Cinq : c'est ce que la maquette affiche sous les champs de saisie, et au-delà
 * une liste de rappels cesse d'être un raccourci pour devenir un écran à lire.
 */
export const DEFAULT_SEARCH_HISTORY_LIMIT = 5;

/**
 * Plafond accepté par l'API.
 * Sans borne haute, un `?limit=100000` ferait payer au serveur — et au réseau
 * mobile de l'utilisateur — une réponse que rien n'affiche (C5, C10).
 */
export const MAX_SEARCH_HISTORY_LIMIT = 20;
