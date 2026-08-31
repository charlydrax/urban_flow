import {
  TransportMode,
  type Itinerary,
  type RouteSegment,
  type SharedMobilityStation,
  type TransportSourceStatus,
} from '@urbanflow/shared';

/**
 * Jeux de données partagés par la suite d'audit d'accessibilité (UF-602).
 *
 * Ils reprennent le **scénario nominal** du projet — Marie, Part-Dieu →
 * Bellecour — plutôt que des valeurs neutres : un audit qui ne rend que des
 * libellés vides ne prouve rien sur les alternatives textuelles réelles.
 */

export function segment(
  mode: TransportMode,
  durationMinutes: number,
  extra: Partial<RouteSegment> = {},
): RouteSegment {
  return {
    mode,
    from: 'Part-Dieu',
    to: 'Bellecour',
    durationMinutes,
    distanceMeters: durationMinutes * 80,
    carbonGrams: 0,
    ...extra,
  };
}

export function itinerary(extra: Partial<Itinerary> = {}): Itinerary {
  const segments = extra.segments ?? [
    segment(TransportMode.WALK, 3),
    segment(TransportMode.BIKE, 11),
    segment(TransportMode.BUS, 6, { line: 'C3' }),
    segment(TransportMode.WALK, 2),
  ];

  return {
    id: 'itin-1',
    summary: 'Marche + Vélo + Bus C3',
    durationMinutes: segments.reduce((total, s) => total + s.durationMinutes, 0),
    distanceMeters: 4200,
    carbonGrams: 240,
    accessible: false,
    segments,
    ...extra,
  };
}

/** Trois options contrastées : la plus verte, la plus rapide, et une accessible PMR. */
export const ITINERARIES: Itinerary[] = [
  itinerary({ id: 'itin-velo', summary: 'Vélo direct', carbonGrams: 0, durationMinutes: 18 }),
  itinerary({
    id: 'itin-metro',
    summary: 'Marche + Métro B',
    carbonGrams: 190,
    durationMinutes: 14,
    accessible: true,
    segments: [
      segment(TransportMode.WALK, 4),
      segment(TransportMode.METRO, 8, {
        line: 'B',
        from: 'Saxe-Gambetta',
        to: 'Bellecour',
        // Horodaté, comme l'est tout segment issu du moteur GTFS : c'est ce qui
        // permet à la carte « prochain départ » (UF-804) d'annoncer une heure.
        departureAt: '2026-08-28T09:47:00+02:00',
        arrivalAt: '2026-08-28T09:55:00+02:00',
      }),
      segment(TransportMode.WALK, 2),
    ],
  }),
  itinerary({ id: 'itin-bus', summary: 'Marche + Bus C3', carbonGrams: 320, durationMinutes: 26 }),
];

/**
 * Stations en libre-service telles que `GET /transport/stations/nearby` les
 * rend : triées par distance croissante, la première n'étant pas toujours
 * louable (UF-804).
 *
 * La borne en panne est en tête **exprès** : c'est le cas que la carte doit
 * traverser sans disparaître, et un jeu où tout va bien ne le prouverait pas.
 */
export const STATIONS: SharedMobilityStation[] = [
  {
    id: 'station-hs',
    name: 'PART-DIEU / VILLETTE',
    lat: 45.7604,
    lng: 4.8598,
    distanceMeters: 90,
    capacity: 20,
    vehiclesAvailable: 0,
    vehicles: [],
    docksAvailable: 20,
    renting: false,
    returning: true,
    lastReportedAt: '2026-08-28T09:40:00+02:00',
  },
  {
    id: 'station-ok',
    name: 'LAFAYETTE / GARIBALDI',
    lat: 45.7618,
    lng: 4.8531,
    distanceMeters: 240,
    capacity: 25,
    vehiclesAvailable: 7,
    vehicles: [{ mode: TransportMode.BIKE, electric: false, count: 7 }],
    docksAvailable: 18,
    renting: true,
    returning: true,
    lastReportedAt: '2026-08-28T09:44:00+02:00',
  },
];

/** Les deux sources F3 en bonne santé — l'état nominal de `GET /transport/status`. */
export const TRANSPORT_STATUSES: TransportSourceStatus[] = [
  {
    source: 'gtfs',
    status: 'ok',
    checkedAt: '2026-08-28T09:45:00+02:00',
    detail: 'OpenTripPlanner opérationnel — GTFS couvrant du 2022-09-01 au 2022-12-10.',
  },
  {
    source: 'gbfs',
    status: 'ok',
    checkedAt: '2026-08-28T09:45:00+02:00',
    detail: 'Flux GBFS opérationnel — 428 station(s) publiée(s), publiées il y a 1 min.',
  },
];
