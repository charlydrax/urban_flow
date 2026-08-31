'use client';

import type { CarbonSummaryDays } from '@urbanflow/shared';
import { useState } from 'react';

import {
  buildCarbonTripsCsv,
  carbonExportFilename,
  describeCarbonTrips,
} from '../../lib/carbon-trips';
import { useCarbonTrips } from './use-carbon-trips';

interface TripTableProps {
  /** Période affichée — la même que celle du reste du tableau de bord. */
  days: CarbonSummaryDays;
}

/**
 * Tableau « Détail par trajet » et export (UF-805) — le dernier bloc de la
 * planche desktop, avec son bouton « 📤 Exporter mes données ».
 *
 * ```
 * Détail par trajet                    [📤 Exporter]
 * Trajet                  Mode      Dist.   CO₂    Évité
 * République → Bellecour  🚲 Vélo'v 2,8 km  0 g    −0,5 kg
 * Domicile → Part-Dieu    🚇 Métro  5,1 km  200 g  −0,8 kg
 * ```
 *
 * ## Un vrai `<table>`, et pas une grille de `div`
 *
 * Cinq colonnes de données appariées à des en-têtes : c'est la définition d'un
 * tableau. Le balisage natif donne aux lecteurs d'écran la navigation cellule
 * par cellule et l'annonce de l'en-tête de colonne — impossibles à reproduire
 * avec des `div`, et la première chose que perd une mise en page « moderne »
 * (C7 — WCAG 1.3.1). Sur mobile, il défile horizontalement dans son propre
 * conteneur plutôt que de faire déborder la page (C2).
 *
 * ## L'export part de ce qui est affiché
 *
 * Le CSV est fabriqué dans le navigateur à partir de la liste déjà chargée :
 * aucun aller-retour, aucune seconde requête SQL pour un contenu qu'on a sous
 * la main (C5/C10). Le corollaire est annoncé à l'écran quand l'API signale une
 * troncature — un relevé partiel qui se présenterait comme complet serait un
 * faux relevé.
 */
export function TripTable({ days }: TripTableProps) {
  const [open, setOpen] = useState(false);
  const { status, page } = useCarbonTrips(days, open);

  const rows = page ? describeCarbonTrips(page.trips) : [];

  const exportCsv = (): void => {
    if (!page || page.trips.length === 0) return;

    // `Blob` + URL d'objet : le fichier n'existe que le temps du clic, et rien
    // ne transite par le réseau — c'est la donnée que le navigateur affiche
    // déjà, rendue à son propriétaire (C8).
    const blob = new Blob([buildCarbonTripsCsv(page.trips)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = carbonExportFilename(days);
    link.click();
    // Sans révocation, le blob resterait en mémoire jusqu'au rechargement de
    // l'onglet — un export répété finirait par y laisser plusieurs copies.
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-labelledby="impact-trips-title"
      className="rounded-lg border border-ink-200 bg-white p-4 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="impact-trips-title" className="text-sm font-bold text-ink">
          Détail par trajet
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            // `aria-expanded` porte l'état du dépliant : sans lui, le bouton
            // annonce « Voir le détail » même une fois le tableau ouvert (C7).
            aria-expanded={open}
            aria-controls="impact-trips-panel"
            onClick={() => setOpen((previous) => !previous)}
            className="min-h-11 rounded-full border-2 border-ink-200 px-4 py-2 text-sm font-bold text-ink-700"
          >
            {open ? 'Masquer le détail' : 'Voir le détail'}
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={status !== 'ready' || rows.length === 0}
            className="min-h-11 rounded-full bg-primary-dark px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            <span aria-hidden="true">📤</span> Exporter mes données
          </button>
        </div>
      </div>

      <div id="impact-trips-panel" hidden={!open}>
        {status === 'loading' && (
          <p aria-live="polite" className="mt-3 text-sm text-ink-500">
            Chargement de vos trajets…
          </p>
        )}

        {status === 'error' && (
          <p role="alert" className="mt-3 rounded-lg bg-tint-red px-4 py-3 text-sm text-error">
            Vos trajets n’ont pas pu être chargés. Vérifiez votre connexion, puis réessayez.
          </p>
        )}

        {status === 'ready' && rows.length === 0 && (
          <p className="mt-3 text-sm text-ink-500">
            Aucun trajet retenu sur cette période : il n’y a rien à détailler ni à exporter.
          </p>
        )}

        {status === 'ready' && rows.length > 0 && (
          <>
            {/* Conteneur défilant : c'est LUI qui déborde, jamais la page (C2). */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <caption className="sr-only">
                  Trajets retenus sur les {days} derniers jours, du plus récent au plus ancien, avec
                  leur distance, le CO₂ émis et le CO₂ évité par rapport à la voiture.
                </caption>
                <thead>
                  <tr className="text-left text-xs text-ink-500">
                    <th scope="col" className="py-2 pr-2 font-bold">
                      Trajet
                    </th>
                    <th scope="col" className="py-2 pr-2 font-bold">
                      Mode
                    </th>
                    <th scope="col" className="py-2 pr-2 font-bold">
                      Distance
                    </th>
                    <th scope="col" className="py-2 pr-2 text-right font-bold">
                      CO₂ émis
                    </th>
                    <th scope="col" className="py-2 text-right font-bold">
                      CO₂ évité
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t border-ink-200 align-top">
                      <th scope="row" className="py-2 pr-2 text-left font-normal">
                        <span className="block font-bold text-ink">{row.routeLabel}</span>
                        <span className="block text-xs text-ink-500">{row.dateLabel}</span>
                      </th>
                      <td className="py-2 pr-2">
                        <span className="flex flex-wrap gap-1">
                          {row.modes.map((mode) => (
                            <span
                              key={mode.key}
                              className="rounded-full px-2 py-0.5 text-xs font-bold text-white"
                              style={{ backgroundColor: mode.color }}
                            >
                              <span aria-hidden="true">{mode.icon}</span> {mode.label}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-ink-700">
                        {/* « — » et non « 0 km » : la distance d'un trajet
                            antérieur à ce ticket est inconnue, pas nulle. */}
                        {row.distanceLabel ?? <span aria-label="distance inconnue">—</span>}
                      </td>
                      <td className="py-2 pr-2 text-right font-bold tabular-nums text-ink">
                        {row.carbonLabel}
                      </td>
                      <td className="py-2 text-right font-bold tabular-nums text-primary-dark">
                        {row.avoidedLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {page?.truncated && (
              <p className="mt-2 text-xs text-ink-500">
                Seuls les {rows.length} trajets les plus récents de la période sont affichés — et
                exportés. Choisissez une période plus courte pour un relevé complet.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
