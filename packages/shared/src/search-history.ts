/**
 * Contrats de l'historique de recherche (UF-204) — `POST/GET /api/search-history`.
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

/**
 * Corps de `POST /api/search-history`.
 * L'identité n'y figure pas : elle vient du JWT vérifié, jamais du corps —
 * sinon n'importe qui écrirait dans l'historique d'autrui (C4 / OWASP A01).
 */
export interface CreateSearchHistoryPayload {
  from: SearchHistoryPlace;
  to: SearchHistoryPlace;
  /** Résumé de l'option retenue (ex. « Marche + Métro B »), quand elle est connue. */
  selectedSummary?: string;
  /** Empreinte de l'option retenue, en grammes de CO₂ — alimente le dashboard carbone. */
  carbonGrams?: number;
}

/** Une recherche enregistrée, telle que relue par l'API. */
export interface SearchHistoryEntry {
  id: string;
  from: SearchHistoryPlace;
  to: SearchHistoryPlace;
  selectedSummary: string | null;
  carbonGrams: number | null;
  /** Horodatage ISO 8601 (C9). */
  createdAt: string;
}

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
