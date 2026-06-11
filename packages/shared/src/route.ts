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

/** Réponse de POST /api/routes/plan, triée par CO₂ croissant. */
export interface PlanRoutesResponse {
  itineraries: Itinerary[];
  sortedBy: 'carbonAsc';
}
