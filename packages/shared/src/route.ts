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

/** Corps de POST /api/routes/plan (contrat du diagramme de séquence MVP). */
export interface PlanRouteRequest {
  from: Place;
  to: Place;
  userId: string;
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

/** Réponse de POST /api/routes/plan, triée par CO₂ croissant. */
export interface PlanRoutesResponse {
  itineraries: Itinerary[];
  sortedBy: 'carbonAsc';
  /**
   * État des trois sources pour **cette** recherche (UF-305).
   *
   * Toujours présent, même quand tout va bien : un tableau où les trois sources
   * sont `available` est une information, pas du remplissage — il dit que la
   * liste d'itinéraires est complète.
   */
  sources: SourceAvailability[];
}
