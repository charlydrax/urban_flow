import type {
  LineStringGeometry,
  TransitJourney,
  TransitLeg,
  TransitPlace,
} from '@urbanflow/shared';

import { TransportMode } from '../../../common/enums/transport-mode.enum';
import type { OtpItinerary, OtpLeg, OtpPlace, OtpWheelchairFlag } from './otp.types';

/**
 * Traduction OpenTripPlanner → contrats internes (`@urbanflow/shared`).
 *
 * Fonctions **pures** : aucune I/O, aucune dépendance NestJS. C'est délibéré —
 * la normalisation est la partie la plus susceptible de casser lors d'une montée
 * de version d'OTP, et elle se teste ici sans réseau ni conteneur.
 *
 * Couvre : C9 (traduction d'un format standard vers le vocabulaire interne),
 * C12 (report de l'accessibilité PMR déclarée dans le GTFS).
 */

/**
 * Correspondance des modes OTP vers le vocabulaire commun front/back.
 *
 * Le graphe lyonnais ne contient que `BUS`, `SUBWAY`, `TRAM` et `FUNICULAR` ;
 * les autres entrées couvrent les réseaux voisins et les évolutions du GTFS.
 *
 * Deux projections méritent justification :
 * - `FUNICULAR` → `METRO` : les funiculaires F1/F2 sont exploités par TCL comme
 *   des lignes du réseau métro (même titre de transport, même traction
 *   électrique, donc même famille de facteur d'émission carbone).
 * - `TROLLEYBUS` → `BUS` : c'est un bus du point de vue de l'usager et du
 *   réseau ; son avantage carbone se joue sur le facteur d'émission, pas sur le
 *   mode affiché.
 */
const MODE_BY_OTP_MODE: Readonly<Record<string, TransportMode>> = {
  WALK: TransportMode.WALK,
  BICYCLE: TransportMode.BIKE,
  SCOOTER: TransportMode.SCOOTER,
  BUS: TransportMode.BUS,
  TROLLEYBUS: TransportMode.BUS,
  COACH: TransportMode.BUS,
  TRAM: TransportMode.TRAM,
  CABLE_CAR: TransportMode.TRAM,
  GONDOLA: TransportMode.TRAM,
  SUBWAY: TransportMode.METRO,
  MONORAIL: TransportMode.METRO,
  FUNICULAR: TransportMode.METRO,
  RAIL: TransportMode.METRO,
  CAR: TransportMode.CARPOOL,
  CARPOOL: TransportMode.CARPOOL,
};

/**
 * Projette un mode OTP sur le vocabulaire interne.
 * @param otpMode Mode brut renvoyé par le moteur
 * @returns Le mode interne, ou `null` si aucune correspondance n'est défendable
 */
export function mapOtpMode(otpMode: string | null | undefined): TransportMode | null {
  if (!otpMode) return null;
  return MODE_BY_OTP_MODE[otpMode.toUpperCase()] ?? null;
}

/**
 * Décode une polyligne « Google encoded polyline » (précision 5) en coordonnées
 * GeoJSON `[lng, lat]`.
 *
 * OTP ne renvoie pas de GeoJSON pour les tracés : le format encodé divise le
 * volume de la réponse par cinq environ, ce qui compte sur un réseau mobile
 * (C5/C10). La conversion est faite ici, une fois, pour que le reste de
 * l'application ne manipule que du GeoJSON standard (C9).
 *
 * @param encoded Chaîne encodée, éventuellement absente
 * @returns Les coordonnées décodées, tableau vide si rien d'exploitable
 */
export function decodePolyline(encoded: string | null | undefined): [number, number][] {
  if (!encoded) return [];

  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Chaque valeur est un delta encodé en groupes de 5 bits ; le bit 0x20
    // signale qu'un groupe supplémentaire suit.
    let deltaLat = 0;
    let deltaLng = 0;

    for (let axis = 0; axis < 2; axis += 1) {
      let result = 0;
      let shift = 0;
      let byte: number;

      do {
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        if (Number.isNaN(byte)) return coordinates; // chaîne tronquée : on garde l'acquis
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      // Bit de poids faible = signe (complément à un sur la valeur décalée).
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) deltaLat = delta;
      else deltaLng = delta;
    }

    lat += deltaLat;
    lng += deltaLng;
    coordinates.push([lng / 1e5, lat / 1e5]);
  }

  return coordinates;
}

/** Construit une géométrie GeoJSON, ou `undefined` si le tracé est inexploitable. */
function toGeometry(coordinates: [number, number][]): LineStringGeometry | undefined {
  // Un LineString valide exige au moins deux points (RFC 7946) : en dessous, on
  // préfère ne rien renvoyer plutôt qu'une géométrie que MapLibre refusera.
  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : undefined;
}

/**
 * Interprète un drapeau d'accessibilité GTFS.
 *
 * `NO_INFORMATION` est traité comme **non accessible** : sur une information
 * manquante, annoncer l'inverse exposerait un usager en fauteuil à un trajet
 * impraticable. Le doute profite à la sécurité de l'usager (C12).
 */
function isWheelchairAccessible(flag: OtpWheelchairFlag | null | undefined): boolean {
  return flag === 'POSSIBLE';
}

/** Convertit un point OTP en lieu interne. */
function toPlace(place: OtpPlace, fallbackName: string): TransitPlace {
  const stopId = place.stop?.gtfsId ?? undefined;
  return {
    name: place.stop?.name ?? place.name ?? fallbackName,
    lat: place.lat,
    lng: place.lon,
    ...(stopId ? { stopId } : {}),
  };
}

/** Arrondit une durée en secondes vers la minute la plus proche, sans jamais rendre 0. */
function toMinutes(seconds: number): number {
  // Un segment de 20 s arrondirait à 0 min et disparaîtrait visuellement de
  // l'itinéraire : on plancher à 1 min pour tout segment non nul.
  if (seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * Normalise un segment OTP.
 * @returns Le segment interne, ou `null` si son mode n'a pas de correspondance
 */
function toLeg(leg: OtpLeg): TransitLeg | null {
  const mode = mapOtpMode(leg.mode);
  if (!mode) return null;

  const transit = leg.transitLeg === true;
  const route = leg.route ?? null;

  // La marche est réputée accessible : OTP a déjà écarté les cheminements
  // impraticables quand la requête est passée en mode fauteuil.
  const accessible = transit
    ? isWheelchairAccessible(leg.trip?.wheelchairAccessible) &&
      isWheelchairAccessible(leg.from.stop?.wheelchairBoarding) &&
      isWheelchairAccessible(leg.to.stop?.wheelchairBoarding)
    : true;

  const line = route?.shortName ?? undefined;
  const lineName = route?.longName ?? undefined;
  const headsign = leg.headsign ?? leg.trip?.tripHeadsign ?? undefined;
  const operator = route?.agency?.name ?? undefined;
  const geometry = toGeometry(decodePolyline(leg.legGeometry?.points));

  return {
    mode,
    sourceMode: (leg.mode ?? '').toUpperCase(),
    transit,
    from: toPlace(leg.from, 'Départ'),
    to: toPlace(leg.to, 'Arrivée'),
    departureAt: new Date(leg.startTime).toISOString(),
    arrivalAt: new Date(leg.endTime).toISOString(),
    durationMinutes: toMinutes(leg.duration),
    distanceMeters: Math.round(leg.distance),
    ...(line ? { line } : {}),
    ...(lineName ? { lineName } : {}),
    ...(headsign ? { headsign } : {}),
    ...(operator ? { operator } : {}),
    accessible,
    ...(geometry ? { geometry } : {}),
  };
}

/**
 * Normalise un itinéraire OTP en trajet interne.
 *
 * @param itinerary Itinéraire brut du moteur
 * @param index Rang dans la réponse, source de l'identifiant stable
 * @returns Le trajet normalisé, ou `null` s'il est inexploitable (itinéraire vide,
 *          ou segment de mode inconnu) — mieux vaut écarter un trajet que
 *          d'annoncer un mode faux au calculateur carbone
 */
export function toTransitJourney(itinerary: OtpItinerary, index: number): TransitJourney | null {
  const rawLegs = itinerary.legs.filter((leg): leg is OtpLeg => Boolean(leg));
  if (rawLegs.length === 0) return null;

  const legs: TransitLeg[] = [];
  for (const rawLeg of rawLegs) {
    const leg = toLeg(rawLeg);
    if (!leg) return null;
    legs.push(leg);
  }

  const transitLegs = legs.filter((leg) => leg.transit);
  const geometry = toGeometry(legs.flatMap((leg) => leg.geometry?.coordinates ?? []));

  return {
    id: `transit-${index + 1}`,
    departureAt: new Date(itinerary.startTime).toISOString(),
    arrivalAt: new Date(itinerary.endTime).toISOString(),
    durationMinutes: toMinutes(itinerary.duration),
    walkDistanceMeters: Math.round(itinerary.walkDistance ?? 0),
    transfers: Math.max(0, transitLegs.length - 1),
    // Un trajet ne vaut que par son maillon le plus faible : une seule
    // correspondance inaccessible le rend impraticable en fauteuil (C12).
    accessible: legs.every((leg) => leg.accessible),
    legs,
    ...(geometry ? { geometry } : {}),
  };
}

/**
 * Normalise la liste d'itinéraires d'une réponse `plan`.
 * @param itineraries Itinéraires bruts, potentiellement `null` ou incomplets
 * @returns Les trajets exploitables, dans l'ordre renvoyé par le moteur
 */
export function toTransitJourneys(
  itineraries: (OtpItinerary | null)[] | null | undefined,
): TransitJourney[] {
  if (!itineraries) return [];

  return itineraries
    .map((itinerary, index) => (itinerary ? toTransitJourney(itinerary, index) : null))
    .filter((journey): journey is TransitJourney => journey !== null);
}
