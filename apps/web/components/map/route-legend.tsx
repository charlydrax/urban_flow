'use client';

import type { Itinerary } from '@urbanflow/shared';

import {
  APPROXIMATE_TRACK_NOTICE,
  hasApproximateTrack,
  routeLegend,
  type TrackPattern,
} from '../../lib/route-map-layers';

/**
 * Longueur du trait d'échantillon, en pixels — assez pour montrer deux tirets
 * complets, ce qu'un trait plus court ne permettrait pas de distinguer d'un
 * trait plein.
 */
const SAMPLE_WIDTH = 34;

/** Motifs SVG alignés sur les `line-dasharray` des couches MapLibre (`use-route-overlay`). */
const SAMPLE_DASH: Record<TrackPattern, { dash?: string; cap: 'round' | 'butt' }> = {
  solid: { cap: 'round' },
  dashed: { dash: '8 5.5', cap: 'butt' },
  // Tirets de longueur nulle + bout arrondi = points ronds, exactement comme
  // MapLibre les rend. Les deux rendus doivent coïncider, sinon la légende
  // décrit un tracé qui n'est pas celui affiché.
  dotted: { dash: '0.01 9', cap: 'round' },
};

/**
 * Clé de lecture du code couleur des modes (UF-403), posée sur la carte comme
 * dans la maquette « DESKTOP 2 : PLANIFICATEUR » (carte blanche, en bas à droite).
 *
 * **Pourquoi elle existe** : sans elle, la couleur seule porterait l'information
 * du mode, ce que WCAG 1.4.1 interdit (C7). Le motif du trait la double déjà,
 * mais un motif n'est pas plus auto-explicite qu'une couleur — il faut le
 * libellé écrit.
 *
 * **Pourquoi elle est dynamique** : elle ne liste que les modes réellement
 * tracés. Une légende figée sur les sept modes ferait apprendre six couleurs
 * pour en lire deux, et laisserait douter de la présence d'un métro invisible.
 *
 * Non interactive et repliée sur `pointer-events-none` : elle se pose sur la
 * carte sans intercepter les gestes de déplacement (le conteneur de surcouches
 * de `MapView` applique déjà la règle, on ne la réactive pas ici).
 *
 * @param itinerary Itinéraire actuellement mis en avant
 */
export function RouteLegend({ itinerary }: { itinerary: Itinerary }) {
  const entries = routeLegend(itinerary);
  const approximate = hasApproximateTrack(itinerary);
  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-md border border-ink-200 bg-white/95 px-3 py-2 shadow-raised">
      {/*
        La liste est déjà décrite en toutes lettres par l'alternative textuelle
        de la carte : la répéter au lecteur d'écran n'ajouterait rien et
        allongerait la lecture. Elle est donc purement visuelle (C7).
      */}
      <p aria-hidden="true" className="mb-1 text-xs font-bold text-ink">
        Légende
      </p>
      <ul aria-hidden="true" className="flex flex-col gap-1">
        {entries.map(({ mode, style }) => {
          const sample = SAMPLE_DASH[style.pattern];
          return (
            <li key={mode} className="flex items-center gap-2 text-xs text-ink-700">
              <svg
                width={SAMPLE_WIDTH}
                height={8}
                viewBox={`0 0 ${SAMPLE_WIDTH} 8`}
                focusable="false"
              >
                <line
                  x1={2}
                  y1={4}
                  x2={SAMPLE_WIDTH - 2}
                  y2={4}
                  stroke={style.color}
                  strokeWidth={4}
                  strokeLinecap={sample.cap}
                  strokeDasharray={sample.dash}
                />
              </svg>
              Segment {style.label.toLowerCase()}
            </li>
          );
        })}
      </ul>
      {/*
        UF-702 : dire que le trait ne suit pas les rues. Le mot n'est pas
        « erreur » — un tracé à vol d'oiseau reste juste sur la direction et
        l'échelle du trajet ; il ne l'est pas sur le chemin. C'est cette nuance
        que la note porte, et c'est pourquoi elle est discrète plutôt
        qu'alarmante.

        `aria-hidden` comme le reste de la légende : la même phrase est déjà
        dans l'alternative textuelle de la carte (`describeRoute`), et la
        répéter allongerait la lecture sans rien apprendre (C7).
      */}
      {approximate && (
        <p
          aria-hidden="true"
          className="mt-1.5 max-w-[14rem] border-t border-ink-200 pt-1.5 text-xs text-ink-700"
        >
          {APPROXIMATE_TRACK_NOTICE}
        </p>
      )}
    </div>
  );
}
