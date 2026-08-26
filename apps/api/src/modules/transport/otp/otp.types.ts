/**
 * Forme **brute** des réponses de l'API GraphQL d'OpenTripPlanner 2.x
 * (`POST /otp/gtfs/v1`).
 *
 * Ces types ne sortent jamais du dossier `otp/` : ils décrivent le protocole du
 * moteur de routage, que `otp.mapper.ts` traduit aussitôt vers les contrats
 * internes de `@urbanflow/shared`. Cette frontière est ce qui rend le connecteur
 * remplaçable sans toucher au Service Itinéraire.
 *
 * Tous les champs sont optionnels ou nullables : OTP renvoie `null` pour les
 * données absentes du GTFS (pas de girouette, arrêt sans accessibilité déclarée),
 * et le mapper doit rester robuste à un flux incomplet.
 */

/** Enveloppe GraphQL : `data` et `errors` peuvent coexister (réponse partielle). */
export interface OtpGraphQlResponse<T> {
  data?: T | null;
  errors?: { message: string }[];
}

/** Période effectivement couverte par le graphe, en secondes epoch. */
export interface OtpServiceTimeRangeData {
  serviceTimeRange: { start: number; end: number } | null;
}

/** Niveau d'accessibilité déclaré dans le GTFS (`wheelchair_accessible`). */
export type OtpWheelchairFlag = 'POSSIBLE' | 'NOT_POSSIBLE' | 'NO_INFORMATION';

/** Arrêt du réseau (absent quand le point est une simple adresse). */
export interface OtpStop {
  gtfsId?: string | null;
  name?: string | null;
  wheelchairBoarding?: OtpWheelchairFlag | null;
}

/** Extrémité d'un segment : adresse de départ/arrivée ou arrêt. */
export interface OtpPlace {
  name?: string | null;
  lat: number;
  lon: number;
  stop?: OtpStop | null;
}

/** Ligne commerciale empruntée. */
export interface OtpRoute {
  shortName?: string | null;
  longName?: string | null;
  mode?: string | null;
  agency?: { name?: string | null } | null;
}

/** Course précise du véhicule. */
export interface OtpTrip {
  tripHeadsign?: string | null;
  wheelchairAccessible?: OtpWheelchairFlag | null;
}

/** Segment d'itinéraire renvoyé par OTP. */
export interface OtpLeg {
  /** `WALK`, `BUS`, `TRAM`, `SUBWAY`, `FUNICULAR`, … */
  mode?: string | null;
  /** Horaires en millisecondes epoch (et non en secondes, contrairement au reste). */
  startTime: number;
  endTime: number;
  /** Durée en secondes. */
  duration: number;
  /** Distance en mètres. */
  distance: number;
  transitLeg?: boolean | null;
  headsign?: string | null;
  /** Tracé encodé en « Google encoded polyline », précision 5. */
  legGeometry?: { points?: string | null } | null;
  route?: OtpRoute | null;
  trip?: OtpTrip | null;
  from: OtpPlace;
  to: OtpPlace;
}

/** Itinéraire complet renvoyé par OTP. */
export interface OtpItinerary {
  /** Durée en secondes. */
  duration: number;
  /** Horaires en millisecondes epoch. */
  startTime: number;
  endTime: number;
  /** Distance totale parcourue à pied, en mètres. */
  walkDistance?: number | null;
  legs: OtpLeg[];
}

/** Racine de la requête `plan`. */
export interface OtpPlanData {
  plan: { itineraries: (OtpItinerary | null)[] | null } | null;
}
