import { TransportMode, type Itinerary, type RouteSegment } from '@urbanflow/shared';

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
      segment(TransportMode.METRO, 8, { line: 'B' }),
      segment(TransportMode.WALK, 2),
    ],
  }),
  itinerary({ id: 'itin-bus', summary: 'Marche + Bus C3', carbonGrams: 320, durationMinutes: 26 }),
];
