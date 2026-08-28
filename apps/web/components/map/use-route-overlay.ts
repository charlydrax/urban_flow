'use client';

import type { Itinerary } from '@urbanflow/shared';
import {
  Marker,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LineLayerSpecification,
  type Map as MapLibreMap,
} from 'maplibre-gl';
import { useEffect } from 'react';

import {
  routeBounds,
  routeMarkers,
  toRouteFeatureCollection,
  type RouteMarker,
} from '../../lib/route-map-layers';

/**
 * Dessin des itinéraires sur la carte MapLibre (UF-403).
 *
 * Pendant impératif du module pur `lib/route-map-layers` : celui-ci décide
 * **quoi** dessiner, celui-là parle à MapLibre. La frontière est utile parce que
 * MapLibre exige un contexte WebGL — la logique testable reste ainsi hors
 * d'atteinte du DOM.
 *
 * Couvre : C9 (source GeoJSON standard), C7 (marqueurs étiquetés, cadrage sans
 * animation sous `prefers-reduced-motion`), C5 (une source et cinq couches
 * créées **une fois**, ensuite alimentées par `setData`).
 */

/** Identifiant de la source unique portant tous les tronçons dessinés. */
const SOURCE_ID = 'uf-routes';

/** Couches, du dessous vers le dessus — l'ordre de ce tableau est l'ordre de dessin. */
const LAYER_IDS = {
  /** Itinéraires non retenus, estompés en arrière-plan. */
  alternatives: 'uf-routes-alternatives',
  /** Liseré blanc sous l'itinéraire retenu : c'est lui qui le détache du fond de carte. */
  casing: 'uf-routes-casing',
  solid: 'uf-routes-solid',
  dashed: 'uf-routes-dashed',
  dotted: 'uf-routes-dotted',
} as const;

/**
 * Épaisseur du tracé selon le zoom.
 *
 * Une largeur fixe donne un trait filiforme à l'échelle de la métropole et un
 * gros boudin à l'échelle de la rue. L'interpolation garde une lisibilité
 * constante sur toute la plage utile du planificateur.
 */
const TRACK_WIDTH: LineLayerSpecification['paint'] = {
  'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 13, 5, 16, 7],
};

/** Marge autour du tracé lors du cadrage, en pixels — la maquette laisse respirer l'itinéraire. */
const FIT_PADDING = { top: 56, right: 56, bottom: 88, left: 56 };

/** Zoom maximal du cadrage : sans plafond, un trajet de 200 m collerait la carte au trottoir. */
const FIT_MAX_ZOOM = 16;

/**
 * Ajoute (une seule fois) la source et les couches de tracé à une carte prête.
 *
 * Cinq couches et non une seule parce que `line-dasharray` **n'est pas pilotable
 * par la donnée** dans MapLibre : impossible d'écrire `["get", "pattern"]` dans
 * un `dasharray`. Chaque motif a donc sa couche, et c'est le filtre qui trie les
 * tronçons entre elles. La couleur, elle, est bien data-driven : une seule
 * expression `["get", "color"]` couvre les sept modes.
 */
function ensureLayers(map: MapLibreMap): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Typée explicitement : sans annotation, TypeScript infère des littéraux
  // `readonly` que la signature (mutable) de `addLayer` refuse.
  const selected: ExpressionSpecification = ['==', ['get', 'selected'], true];

  // Les autres options restent visibles mais en retrait : l'usager voit qu'il y
  // a d'autres chemins possibles sans que le tracé retenu se perde dedans.
  map.addLayer({
    id: LAYER_IDS.alternatives,
    type: 'line',
    source: SOURCE_ID,
    filter: ['!=', ['get', 'selected'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 13, 3, 16, 4],
      'line-opacity': 0.3,
    },
  });

  // Liseré blanc : sur un fond de carte clair, un trait de couleur seul perd le
  // contraste dès qu'il croise un parc ou un plan d'eau (WCAG 1.4.11 — C7).
  map.addLayer({
    id: LAYER_IDS.casing,
    type: 'line',
    source: SOURCE_ID,
    filter: selected,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 13, 9, 16, 12],
      'line-opacity': 0.95,
    },
  });

  map.addLayer({
    id: LAYER_IDS.solid,
    type: 'line',
    source: SOURCE_ID,
    filter: ['all', selected, ['==', ['get', 'pattern'], 'solid']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], ...TRACK_WIDTH },
  });

  // Tirets larges des lignes régulières, comme le « Segment bus » de la maquette.
  map.addLayer({
    id: LAYER_IDS.dashed,
    type: 'line',
    source: SOURCE_ID,
    filter: ['all', selected, ['==', ['get', 'pattern'], 'dashed']],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], ...TRACK_WIDTH, 'line-dasharray': [1.6, 1.1] },
  });

  // Pointillé de la marche : des tirets de longueur nulle qui, avec un bout
  // arrondi, se rendent en points ronds. C'est l'idiome MapLibre pour un
  // pointillé — il n'existe pas de motif « dot » natif.
  map.addLayer({
    id: LAYER_IDS.dotted,
    type: 'line',
    source: SOURCE_ID,
    filter: ['all', selected, ['==', ['get', 'pattern'], 'dotted']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], ...TRACK_WIDTH, 'line-dasharray': [0, 1.9] },
  });
}

/** Construit la pastille DOM d'un repère — styles dans `app/globals.css`. */
function createMarkerElement(marker: RouteMarker): HTMLElement {
  const element = document.createElement('div');
  element.className = `uf-route-marker uf-route-marker--${marker.kind}`;
  // Couleur portée par la donnée (mode du segment) : elle ne peut pas vivre
  // dans une classe CSS figée.
  element.style.setProperty('--uf-marker-color', marker.color);
  element.textContent = marker.glyph;
  // Le repère **est** l'information pour un lecteur d'écran : sans étiquette, il
  // ne serait qu'un `div` vide au milieu du canvas (C7 — WCAG 1.1.1).
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', marker.ariaLabel);
  return element;
}

/**
 * Trace les itinéraires, pose les repères et cadre la carte sur l'option retenue.
 *
 * @param map Instance MapLibre déjà chargée (`load` émis), ou `null` tant qu'elle ne l'est pas
 * @param itineraries Itinéraires à dessiner — tous, y compris les non retenus
 * @param selectedItineraryId Itinéraire mis en avant ; `null` n'estompe pas, il n'affiche rien en avant
 */
export function useRouteOverlay(
  map: MapLibreMap | null,
  itineraries: readonly Itinerary[],
  selectedItineraryId: string | null,
): void {
  // --- Tracés -------------------------------------------------------------
  useEffect(() => {
    if (!map) return;

    ensureLayers(map);
    // `setData` plutôt qu'une source recréée : MapLibre remplace le contenu du
    // tampon sans reconstruire les couches ni relancer le style (C5/C10).
    const source = map.getSource<GeoJSONSource>(SOURCE_ID);
    source?.setData(toRouteFeatureCollection(itineraries, selectedItineraryId));
  }, [map, itineraries, selectedItineraryId]);

  // --- Repères départ / arrivée / correspondances --------------------------
  //
  // Les marqueurs MapLibre sont des nœuds DOM positionnés hors du canvas : ils
  // ne peuvent pas vivre dans la source GeoJSON, d'où cet effet séparé. Ils sont
  // détruits et reposés à chaque changement de sélection — quelques éléments,
  // remplacés au clic, cela ne justifie pas une réconciliation par identifiant.
  useEffect(() => {
    if (!map) return;

    const itinerary = itineraries.find((candidate) => candidate.id === selectedItineraryId);
    if (!itinerary) return;

    const markers = routeMarkers(itinerary).map((marker) =>
      new Marker({ element: createMarkerElement(marker) }).setLngLat(marker.position).addTo(map),
    );

    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [map, itineraries, selectedItineraryId]);

  // --- Cadrage ------------------------------------------------------------
  useEffect(() => {
    if (!map) return;

    const itinerary = itineraries.find((candidate) => candidate.id === selectedItineraryId);
    const bounds = itinerary ? routeBounds(itinerary) : null;
    if (!bounds) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Recette 3 du ticket : la carte cadre l'itinéraire entier. Le plafond de
    // zoom évite qu'un trajet de 200 m ne colle la caméra au trottoir.
    map.fitBounds(bounds, {
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
      duration: prefersReducedMotion ? 0 : 700,
    });
  }, [map, itineraries, selectedItineraryId]);
}
