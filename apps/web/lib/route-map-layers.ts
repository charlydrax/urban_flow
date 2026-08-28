import { TransportMode, type Itinerary, type RouteSegment } from '@urbanflow/shared';

import { urbanflowColors } from './design-tokens';

/**
 * Traduction des itinéraires en données de carte (UF-403) — étape 9 du flux de
 * référence, « affichage carte ».
 *
 * Module **pur** : il ne connaît ni MapLibre ni React, il produit du GeoJSON,
 * des bornes et une légende. C'est ce qui le rend testable dans l'environnement
 * `node` de Vitest, alors que le dessin lui-même (sources, couches, marqueurs)
 * exige un contexte WebGL — voir `components/map/use-route-overlay.ts`.
 *
 * Couvre : C9 (GeoJSON standard), C7 (le style de trait double la couleur,
 * WCAG 1.4.1), C5 (une seule source pour tous les itinéraires).
 */

/**
 * Style de trait d'une famille de modes.
 *
 * La couleur seule ne suffit pas (WCAG 1.4.1 « Utilisation de la couleur ») :
 * un daltonisme deutan rapproche fortement le vert vélo et le brun trottinette.
 * Le motif du trait porte donc la même information une seconde fois.
 */
export type TrackPattern =
  /** Trait plein — on avance par ses propres moyens sur un tracé continu (vélo, trottinette). */
  | 'solid'
  /** Tirets larges — on est transporté sur une ligne régulière (bus, tram, métro, covoiturage). */
  | 'dashed'
  /** Pointillé fin — marche : le tracé est indicatif, pas un cheminement piéton calculé. */
  | 'dotted';

/** Apparence d'un mode sur la carte : sa couleur de charte et son motif de trait. */
export interface ModeTrackStyle {
  color: string;
  pattern: TrackPattern;
  /** Libellé de légende, en français (l'UI du produit — CLAUDE.md §7). */
  label: string;
}

/**
 * Code couleur et motif par mode — repris de la maquette Figma
 * « 03 · Maquettes desktop → DESKTOP 2 : PLANIFICATEUR ».
 *
 * Les couleurs sont les tokens `--color-mode-*` de la charte (UF-007), pas des
 * valeurs choisies ici : la pastille de mode d'une carte de résultat et le tracé
 * correspondant sur la carte doivent être **la même** couleur, sinon le lien
 * entre les deux se perd.
 *
 * Deux arbitrages à signaler :
 *
 * - **La marche** n'apparaît sur aucune maquette (les tracés dessinés y sont
 *   vélo et bus). Elle prend donc l'encre neutre Ink 500 plutôt qu'une sixième
 *   couleur inventée : la marche encadre presque tous les itinéraires, la mettre
 *   en couleur vive la ferait concurrencer le mode qui, lui, caractérise
 *   l'option. Le pointillé fin demandé par le ticket la rend malgré tout
 *   immédiatement identifiable.
 * - **Le covoiturage** n'est encore produit par aucune source (F3 couvre GTFS et
 *   GBFS). Il est mappé sur l'ocre « warning » pour que ce tableau reste
 *   exhaustif — ajouter un mode à l'énumération partagée doit casser la
 *   compilation ici, pas passer inaperçu. À reprendre depuis la maquette le jour
 *   où un itinéraire en produit réellement.
 */
export const MODE_TRACK_STYLES: Record<TransportMode, ModeTrackStyle> = {
  [TransportMode.WALK]: { color: urbanflowColors.ink500, pattern: 'dotted', label: 'Marche' },
  [TransportMode.BIKE]: { color: urbanflowColors.modeBike, pattern: 'solid', label: 'Vélo' },
  [TransportMode.SCOOTER]: {
    color: urbanflowColors.modeScooter,
    pattern: 'solid',
    label: 'Trottinette',
  },
  [TransportMode.BUS]: { color: urbanflowColors.modeBus, pattern: 'dashed', label: 'Bus' },
  [TransportMode.TRAM]: { color: urbanflowColors.modeTram, pattern: 'dashed', label: 'Tram' },
  [TransportMode.METRO]: { color: urbanflowColors.modeMetro, pattern: 'dashed', label: 'Métro' },
  [TransportMode.CARPOOL]: {
    color: urbanflowColors.warning,
    pattern: 'dashed',
    label: 'Covoiturage',
  },
};

/** Propriétés portées par chaque tronçon dessiné — lues par les filtres MapLibre. */
export interface RouteFeatureProperties {
  /** Itinéraire auquel appartient le tronçon : sert au filtre « sélectionné / autres ». */
  itineraryId: string;
  mode: TransportMode;
  /** Couleur résolue, poussée dans la donnée pour piloter `line-color` sans expression géante. */
  color: string;
  /**
   * Motif du trait. MapLibre **ne sait pas** piloter `line-dasharray` par la
   * donnée (ce n'est pas une propriété « data-driven ») : il faut une couche par
   * motif, et ce champ est ce sur quoi elles filtrent.
   */
  pattern: TrackPattern;
  /** `true` pour l'itinéraire mis en avant — les autres sont estompés. */
  selected: boolean;
}

/** Tronçon dessinable : un segment, sa géométrie et son apparence. */
export type RouteFeature = GeoJSON.Feature<GeoJSON.LineString, RouteFeatureProperties>;

/** Ensemble poussé dans l'unique source GeoJSON de la carte. */
export type RouteFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.LineString,
  RouteFeatureProperties
>;

/** Emprise rectangulaire `[[ouest, sud], [est, nord]]`, au format attendu par `fitBounds`. */
export type MapBounds = [[number, number], [number, number]];

/** Repère posé sur la carte : les deux extrémités et les correspondances. */
export interface RouteMarker {
  /** Identité stable — évite de recréer tous les marqueurs à chaque rendu. */
  id: string;
  kind: 'start' | 'end' | 'transfer';
  position: [number, number];
  /** Lettre affichée dans la pastille (« A », « B ») — vide pour une correspondance. */
  glyph: string;
  /** Couleur de remplissage (extrémités) ou de contour (correspondance). */
  color: string;
  /** Étiquette lue par les technologies d'assistance (C7). */
  ariaLabel: string;
}

/**
 * Construit la collection GeoJSON de **tous** les itinéraires en une passe.
 *
 * Une seule source pour l'ensemble, plutôt qu'une par itinéraire : changer de
 * sélection revient alors à repousser la même donnée avec un booléen différent,
 * là où des sources multiples imposeraient d'en créer et d'en détruire à chaque
 * clic (C5). Les itinéraires non retenus restent dessinés, estompés — c'est ce
 * qui montre qu'il y a d'autres options, et à quoi elles ressemblent.
 *
 * Les segments sans géométrie sont simplement ignorés : une source peut n'avoir
 * rendu que des durées, ce n'est pas une raison pour ne rien dessiner du reste
 * de l'itinéraire (C10).
 *
 * @param itineraries Itinéraires renvoyés par `POST /routes/plan`
 * @param selectedId Itinéraire mis en avant — `null` pendant le chargement
 * @returns Une `FeatureCollection` de `LineString`, prête pour `source.setData`
 */
export function toRouteFeatureCollection(
  itineraries: readonly Itinerary[],
  selectedId: string | null,
): RouteFeatureCollection {
  const features: RouteFeature[] = [];

  for (const itinerary of itineraries) {
    for (const segment of itinerary.segments) {
      const coordinates = segment.geometry?.coordinates;
      if (!coordinates || coordinates.length < 2) continue;

      const style = MODE_TRACK_STYLES[segment.mode];
      features.push({
        type: 'Feature',
        // `id` numérique exigé par MapLibre pour identifier une entité ; on
        // garde l'identifiant métier dans les propriétés, où il reste filtrable.
        id: features.length,
        geometry: { type: 'LineString', coordinates: [...coordinates] },
        properties: {
          itineraryId: itinerary.id,
          mode: segment.mode,
          color: style.color,
          pattern: style.pattern,
          selected: itinerary.id === selectedId,
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Emprise d'un itinéraire, pour cadrer la carte dessus (`fitBounds`).
 *
 * Calculée sur les **segments** et non sur `itinerary.geometry` : c'est ce qui
 * est réellement dessiné, et les deux peuvent diverger si une source n'a pas
 * fourni sa géométrie. Cadrer sur autre chose que le tracé visible donnerait un
 * itinéraire qui dépasse du cadre.
 *
 * @returns `null` quand aucun segment n'a de tracé — l'appelant garde alors son
 * cadrage courant plutôt que de sauter sur des coordonnées vides.
 */
export function routeBounds(itinerary: Itinerary): MapBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const segment of itinerary.segments) {
    for (const [lng, lat] of segment.geometry?.coordinates ?? []) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }

  if (west === Infinity) return null;
  return [
    [west, south],
    [east, north],
  ];
}

/**
 * Repères de l'itinéraire retenu : départ « A », arrivée « B », correspondances.
 *
 * Reprend les pastilles de la maquette. Une correspondance est **un changement
 * de mode**, pas une jonction de segments : marcher puis marcher encore ne
 * mérite pas un repère, alors que descendre du vélo pour prendre le bus, si.
 * Elle est colorée par le mode qui **commence** — le repère annonce ce qu'on
 * prend, il ne commémore pas ce qu'on quitte.
 *
 * @param itinerary Itinéraire sélectionné
 * @returns Repères dans l'ordre du trajet ; vide si aucun segment n'a de tracé
 */
export function routeMarkers(itinerary: Itinerary): RouteMarker[] {
  const drawn = itinerary.segments.filter(hasGeometry);
  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  if (!first || !last) return [];

  const markers: RouteMarker[] = [
    {
      id: `${itinerary.id}:start`,
      kind: 'start',
      position: firstPoint(first),
      glyph: 'A',
      color: urbanflowColors.action,
      ariaLabel: `Départ : ${first.from}`,
    },
  ];

  for (let index = 1; index < drawn.length; index += 1) {
    const previous = drawn[index - 1]!;
    const current = drawn[index]!;
    if (previous.mode === current.mode) continue;

    const style = MODE_TRACK_STYLES[current.mode];
    const boarding = current.line ?? style.label.toLowerCase();
    markers.push({
      id: `${itinerary.id}:transfer:${index}`,
      kind: 'transfer',
      position: firstPoint(current),
      glyph: '',
      color: style.color,
      ariaLabel: `Correspondance à ${current.from} : ${boarding}`,
    });
  }

  markers.push({
    id: `${itinerary.id}:end`,
    kind: 'end',
    position: lastPoint(last),
    glyph: 'B',
    color: urbanflowColors.primary,
    ariaLabel: `Arrivée : ${last.to}`,
  });

  return markers;
}

/**
 * Légende du tracé affiché : un mode par ligne, dans l'ordre du trajet.
 *
 * Dynamique et non figée sur les sept modes : une légende qui annonce « métro »
 * là où aucun métro n'est dessiné apprend une couleur inutile et fait douter de
 * ce qu'on voit. C'est la clé de lecture du code couleur exigée par WCAG 1.4.1
 * — sans elle, la couleur seule porterait l'information du mode.
 *
 * @returns Modes distincts de l'itinéraire, dans l'ordre de première apparition
 */
export function routeLegend(
  itinerary: Itinerary,
): { mode: TransportMode; style: ModeTrackStyle }[] {
  const seen = new Set<TransportMode>();
  const legend: { mode: TransportMode; style: ModeTrackStyle }[] = [];

  for (const segment of itinerary.segments) {
    if (!hasGeometry(segment) || seen.has(segment.mode)) continue;
    seen.add(segment.mode);
    legend.push({ mode: segment.mode, style: MODE_TRACK_STYLES[segment.mode] });
  }

  return legend;
}

/**
 * Description en toutes lettres du tracé, pour qui ne voit pas la carte (C7 —
 * WCAG 1.1.1). Remplace l'alternative générique de la carte dès qu'un itinéraire
 * est affiché : « les itinéraires y seront tracés » n'apprend plus rien une fois
 * qu'ils le sont.
 */
export function describeRoute(itinerary: Itinerary): string {
  const legs = itinerary.segments.map((segment) => {
    const style = MODE_TRACK_STYLES[segment.mode];
    const label = segment.line ? `${style.label} ${segment.line}` : style.label;
    return `${label} de ${segment.from} à ${segment.to} (${segment.durationMinutes} min)`;
  });

  return `Itinéraire tracé sur la carte : ${legs.join(', puis ')}. Durée totale ${itinerary.durationMinutes} minutes.`;
}

/** Un segment n'est dessinable qu'avec au moins deux points (RFC 7946 — C9). */
function hasGeometry(
  segment: RouteSegment,
): segment is RouteSegment & { geometry: { type: 'LineString'; coordinates: [number, number][] } } {
  return (segment.geometry?.coordinates.length ?? 0) >= 2;
}

function firstPoint(segment: RouteSegment): [number, number] {
  return segment.geometry!.coordinates[0]!;
}

function lastPoint(segment: RouteSegment): [number, number] {
  const coordinates = segment.geometry!.coordinates;
  return coordinates[coordinates.length - 1]!;
}
