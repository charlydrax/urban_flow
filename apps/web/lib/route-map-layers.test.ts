import { TransportMode, type Itinerary, type RouteSegment } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import { contrastRatio } from './design-tokens';
import {
  MODE_TRACK_STYLES,
  describeRoute,
  routeBounds,
  routeLegend,
  routeMarkers,
  toRouteFeatureCollection,
} from './route-map-layers';

/**
 * Fond de carte le plus clair rencontré sous un tracé : le blanc du liseré posé
 * par la couche `casing`. C'est lui, et non les tuiles, qui borne le contraste
 * des traits de couleur (C7 — WCAG 1.4.11).
 */
const CASING_WHITE = '#ffffff';

function segment(
  mode: TransportMode,
  coordinates: [number, number][],
  extra: Partial<RouteSegment> = {},
): RouteSegment {
  return {
    mode,
    from: 'A',
    to: 'B',
    durationMinutes: 5,
    distanceMeters: 800,
    carbonGrams: 10,
    ...(coordinates.length >= 2 ? { geometry: { type: 'LineString', coordinates } } : {}),
    ...extra,
  };
}

function itinerary(id: string, segments: RouteSegment[]): Itinerary {
  return {
    id,
    summary: 'Marche + Métro B',
    durationMinutes: 22,
    distanceMeters: 4200,
    carbonGrams: 14,
    accessible: true,
    segments,
  };
}

const WALK_LEG = segment(
  TransportMode.WALK,
  [
    [4.85, 45.75],
    [4.86, 45.76],
  ],
  { from: 'Départ', to: 'Bellecour' },
);

const METRO_LEG = segment(
  TransportMode.METRO,
  [
    [4.86, 45.76],
    [4.88, 45.77],
  ],
  { from: 'Bellecour', to: 'Part-Dieu', line: 'B' },
);

describe('toRouteFeatureCollection', () => {
  it('produit un tronçon par segment, coloré selon son mode', () => {
    const collection = toRouteFeatureCollection([itinerary('a', [WALK_LEG, METRO_LEG])], 'a');

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0]?.properties.color).toBe(
      MODE_TRACK_STYLES[TransportMode.WALK].color,
    );
    expect(collection.features[1]?.properties.color).toBe(
      MODE_TRACK_STYLES[TransportMode.METRO].color,
    );
  });

  it('marque comme sélectionné le seul itinéraire retenu, les autres restant dessinés', () => {
    const collection = toRouteFeatureCollection(
      [itinerary('a', [WALK_LEG]), itinerary('b', [METRO_LEG])],
      'b',
    );

    expect(collection.features.map((feature) => feature.properties.selected)).toEqual([
      false,
      true,
    ]);
  });

  // Dégradation gracieuse (C10) : une source muette sur la géométrie ne doit pas
  // empêcher le reste de l'itinéraire d'être tracé.
  it('ignore les segments sans tracé exploitable', () => {
    const orphan = segment(TransportMode.BUS, []);
    const single = segment(TransportMode.BUS, [[4.85, 45.75]] as [number, number][]);

    const collection = toRouteFeatureCollection([itinerary('a', [orphan, single, WALK_LEG])], 'a');

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties.mode).toBe(TransportMode.WALK);
  });

  it('recopie les coordonnées au lieu de partager le tableau de la réponse API', () => {
    const trip = itinerary('a', [WALK_LEG]);
    const collection = toRouteFeatureCollection([trip], 'a');

    expect(collection.features[0]?.geometry.coordinates).not.toBe(WALK_LEG.geometry?.coordinates);
    expect(collection.features[0]?.geometry.coordinates).toEqual(WALK_LEG.geometry?.coordinates);
  });
});

describe('routeBounds', () => {
  it('englobe tous les points de tous les segments', () => {
    expect(routeBounds(itinerary('a', [WALK_LEG, METRO_LEG]))).toEqual([
      [4.85, 45.75],
      [4.88, 45.77],
    ]);
  });

  it('rend null quand rien n’est dessinable — la caméra garde alors son cadrage', () => {
    expect(routeBounds(itinerary('a', [segment(TransportMode.BUS, [])]))).toBeNull();
  });
});

describe('routeMarkers', () => {
  it('pose « A » au départ, « B » à l’arrivée et une correspondance au changement de mode', () => {
    const markers = routeMarkers(itinerary('a', [WALK_LEG, METRO_LEG]));

    expect(markers.map((marker) => marker.kind)).toEqual(['start', 'transfer', 'end']);
    expect(markers[0]?.position).toEqual([4.85, 45.75]);
    expect(markers[2]?.position).toEqual([4.88, 45.77]);
  });

  it('colore la correspondance avec le mode que l’on prend, pas celui que l’on quitte', () => {
    const markers = routeMarkers(itinerary('a', [WALK_LEG, METRO_LEG]));

    expect(markers[1]?.color).toBe(MODE_TRACK_STYLES[TransportMode.METRO].color);
    expect(markers[1]?.ariaLabel).toBe('Correspondance à Bellecour : B');
  });

  it('ne pose pas de correspondance entre deux segments du même mode', () => {
    const secondWalk = segment(
      TransportMode.WALK,
      [
        [4.86, 45.76],
        [4.87, 45.77],
      ],
      { from: 'Bellecour', to: 'Cordeliers' },
    );

    const markers = routeMarkers(itinerary('a', [WALK_LEG, secondWalk]));

    expect(markers.map((marker) => marker.kind)).toEqual(['start', 'end']);
  });

  it('n’invente aucun repère quand aucun segment n’est dessinable', () => {
    expect(routeMarkers(itinerary('a', [segment(TransportMode.BUS, [])]))).toEqual([]);
  });
});

describe('routeLegend', () => {
  it('ne liste que les modes réellement tracés, une seule fois chacun', () => {
    const secondWalk = segment(TransportMode.WALK, [
      [4.88, 45.77],
      [4.89, 45.78],
    ]);

    const legend = routeLegend(itinerary('a', [WALK_LEG, METRO_LEG, secondWalk]));

    expect(legend.map((entry) => entry.mode)).toEqual([TransportMode.WALK, TransportMode.METRO]);
  });
});

describe('describeRoute', () => {
  // C7 — WCAG 1.1.1 : la carte est inaccessible sans cette description.
  it('énonce chaque segment, sa ligne et la durée totale', () => {
    expect(describeRoute(itinerary('a', [WALK_LEG, METRO_LEG]))).toBe(
      'Itinéraire tracé sur la carte : Marche de Départ à Bellecour (5 min), puis Métro B de Bellecour à Part-Dieu (5 min). Durée totale 22 minutes.',
    );
  });
});

describe('code couleur des modes (C7)', () => {
  // Chaque tracé est posé sur un liseré blanc : sous 3:1 il serait illisible pour
  // une vision faible, quel que soit le fond de carte (WCAG 1.4.11).
  it('garde chaque couleur de mode à 3:1 au moins sur le liseré blanc', () => {
    for (const [mode, style] of Object.entries(MODE_TRACK_STYLES)) {
      expect(contrastRatio(style.color, CASING_WHITE), mode).toBeGreaterThanOrEqual(3);
    }
  });

  // La couleur seule ne peut pas porter l'information (WCAG 1.4.1) : deux modes
  // de même couleur devraient au moins se distinguer par le motif du trait.
  it('ne laisse jamais deux modes partager à la fois la couleur et le motif', () => {
    const signatures = Object.values(MODE_TRACK_STYLES).map(
      (style) => `${style.color}/${style.pattern}`,
    );

    expect(new Set(signatures).size).toBe(signatures.length);
  });
});
