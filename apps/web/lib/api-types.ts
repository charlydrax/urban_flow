/**
 * Types miroirs des contrats de l'API NestJS (DTO Swagger — C9).
 * Source de vérité : apps/api/src/modules/<asterisk>/dto.
 * À terme, ces types pourront être générés depuis le schéma OpenAPI (/api/docs-json).
 */

/** Modes de transport du planificateur multimodal (F2/F3). */
export type TransportMode = 'WALK' | 'BIKE' | 'SCOOTER' | 'BUS' | 'TRAM' | 'METRO' | 'CARPOOL';

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

/** Segment d'itinéraire avec son empreinte CO₂. */
export interface RouteSegment {
  mode: TransportMode;
  from: string;
  to: string;
  durationMinutes: number;
  distanceMeters: number;
  carbonGrams: number;
  line?: string;
}

/** Itinéraire multimodal complet (tracé GeoJSON pour MapLibre — C9). */
export interface Itinerary {
  id: string;
  summary: string;
  durationMinutes: number;
  distanceMeters: number;
  carbonGrams: number;
  accessible: boolean;
  segments: RouteSegment[];
  geometry?: { type: 'LineString'; coordinates: [number, number][] };
}

/** Réponse de POST /api/routes/plan, triée par CO₂ croissant. */
export interface PlanRoutesResponse {
  itineraries: Itinerary[];
  sortedBy: 'carbonAsc';
}

/** Réponse des endpoints d'authentification (F1). */
export interface AuthResponse {
  accessToken: string;
  user: { id: string; email: string };
}

/** Tableau de bord carbone personnel. */
export interface CarbonDashboard {
  period: { from: string; to: string };
  totalEmittedGrams: number;
  totalAvoidedGrams: number;
  tripsCount: number;
}
