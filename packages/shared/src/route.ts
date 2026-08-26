import { TransportMode } from './transport-mode';

/**
 * Contrats du planificateur d'itinéraires (F2) — `POST /api/routes/plan`.
 * Source de vérité unique du contrat front/back (C9) : les DTO NestJS
 * (`apps/api`) implémentent ces interfaces, le client (`apps/web`) les consomme.
 */

/** Lieu de départ/arrivée — coordonnées issues de la Geolocation API (C6). */
export interface Place {
  label: string;
  lat?: number;
  lng?: number;
}

/**
 * Corps de `POST /api/routes/plan`.
 *
 * ⚠️ **Aucun `userId`** (C4 / OWASP A01). Le diagramme de séquence du MVP en
 * portait un ; l'endpoint définitif (UF-402) ne l'accepte plus. L'auteur d'une
 * recherche est toujours le porteur du JWT vérifié — il n'y a donc aucun champ
 * à falsifier pour lire les préférences ou écrire dans l'historique d'un autre
 * compte. Le `ValidationPipe` global (`whitelist` + `forbidNonWhitelisted`) fait
 * d'ailleurs échouer en `400` toute requête qui en envoie un.
 */
export interface PlanRouteRequest {
  from: Place;
  to: Place;
}

/** Tracé GeoJSON LineString [lng, lat] pour l'affichage MapLibre (format standard — C9). */
export interface LineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

/** Segment d'itinéraire (une portion avec un seul mode) avec son empreinte CO₂. */
export interface RouteSegment {
  mode: TransportMode;
  from: string;
  to: string;
  durationMinutes: number;
  distanceMeters: number;
  carbonGrams: number;
  line?: string;
}

/** Itinéraire multimodal complet (tracé GeoJSON pour MapLibre — C9, accessibilité PMR — C12). */
export interface Itinerary {
  id: string;
  summary: string;
  durationMinutes: number;
  distanceMeters: number;
  carbonGrams: number;
  accessible: boolean;
  segments: RouteSegment[];
  geometry?: LineStringGeometry;
}

/**
 * Nom d'une des trois sources du planificateur (UF-305).
 *
 * Nommé plutôt que répété en union anonyme : la collecte (UF-305), l'état
 * publié au client et le diagnostic (UF-306) parlent des mêmes trois sources.
 * Un seul type garantit qu'ajouter une quatrième source casse à la compilation
 * partout où il faut la traiter, plutôt que silencieusement nulle part.
 */
export type RouteSourceName = 'transit' | 'sharedMobility' | 'cyclePaths';

/**
 * État d'une des trois sources interrogées par le planificateur (UF-305).
 *
 * Publié dans la réponse parce que le client ne peut pas le deviner : une liste
 * sans option vélo peut vouloir dire « aucun vélo praticable ici » ou «
 * l'opérateur n'a pas répondu », et ce n'est pas la même chose à annoncer à
 * l'usager. C'est ce qui alimente le bandeau « mode dégradé » (C10).
 */
export interface SourceAvailability {
  /** `transit` (GTFS), `sharedMobility` (GBFS) ou `cyclePaths` (PostGIS). */
  source: RouteSourceName;
  /** `false` quand la source n'a rien pu fournir pour cette recherche. */
  available: boolean;
  /**
   * Cause de l'indisponibilité, renseignée uniquement si `available` est `false`.
   *
   * Volontairement générique (`timeout`, `network`, `upstream-error`,
   * `internal-error`) : le détail technique reste dans les logs du serveur, il
   * n'apprendrait rien à l'usager et exposerait notre topologie (C11).
   */
  reason?: 'timeout' | 'network' | 'upstream-error' | 'internal-error';
}

/**
 * Clé de tri appliquée par le serveur à la liste d'itinéraires.
 *
 * Déduite de la priorité du profil de mobilité (F1) et **publiée** : le client
 * doit pouvoir annoncer « classés par empreinte » ou « classés par durée » sans
 * avoir à relire les préférences de l'usager, et sans déduire l'ordre en
 * comparant lui-même les valeurs.
 */
export type ItinerarySortKey =
  /** Empreinte carbone croissante — priorité « écolo », choix par défaut du produit. */
  | 'carbonAsc'
  /** Durée totale croissante — priorité « rapide ». */
  | 'durationAsc';

/** Réponse de POST /api/routes/plan, triée selon la priorité du profil. */
export interface PlanRoutesResponse {
  itineraries: Itinerary[];
  sortedBy: ItinerarySortKey;
  /**
   * État des trois sources pour **cette** recherche (UF-305).
   *
   * Toujours présent, même quand tout va bien : un tableau où les trois sources
   * sont `available` est une information, pas du remplissage — il dit que la
   * liste d'itinéraires est complète.
   */
  sources: SourceAvailability[];
  /**
   * Identifiant de la ligne écrite dans l'historique pour cette recherche
   * (UF-204, étape 18 du flux) — `null` si l'écriture a échoué.
   *
   * Publié pour que le client n'ait pas à enregistrer la recherche lui-même :
   * un second `POST /search-history` créerait un doublon de ce que le serveur
   * vient d'écrire. Il lui sert aussi de référence pour rattacher plus tard
   * l'option effectivement retenue.
   *
   * `null` n'est pas une erreur à afficher : ne pas mémoriser un trajet est un
   * désagrément, pas une panne de la recherche (C10).
   */
  searchHistoryId: string | null;
}
