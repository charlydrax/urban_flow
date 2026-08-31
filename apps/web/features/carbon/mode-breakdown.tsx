'use client';

import type { CarbonModeTotals } from '@urbanflow/shared';

import { describeCarbonModes } from '../../lib/carbon-modes';

interface ModeBreakdownProps {
  /** Cumuls par mode publiés par `GET /api/carbon/summary`. */
  modeBreakdown: CarbonModeTotals[];
  /** Total émis de la période — le dénominateur des parts. */
  emittedGrams: number;
}

/**
 * Répartition des émissions par mode (UF-805) — « Émissions par mode » sur la
 * planche mobile, « Répartition des émissions » sur la version desktop.
 *
 * ```
 * Émissions par mode
 * 🚌 Bus       ████████████░░░░░░░  5,9 kg  44 %
 * 🚇 Métro     ████████░░░░░░░░░░░  3,8 kg  28 %
 * 🛴 Trott.    ███████░░░░░░░░░░░░  3,4 kg  25 %
 * ```
 *
 * ## Le bloc que UF-505 avait écarté
 *
 * Le tableau de bord d'origine notait explicitement l'absence de ce bloc :
 * « elle supposerait de stocker le détail par segment de chaque trajet retenu,
 * donc une table de plus ». C'est ce que fait ce ticket
 * (`trip_mode_footprints`), et le composant ne calcule donc rien — il peint des
 * totaux que la base a déjà agrégés (C5).
 *
 * ## Accessibilité (C7)
 *
 * Les barres sont **décoratives** : chaque ligne porte son libellé, sa valeur
 * en grammes et sa part en pourcentage écrits en toutes lettres. La liste
 * entière est par ailleurs doublée d'une phrase unique (`description`), parce
 * qu'un lecteur d'écran annonçant douze cellules de nombres ne dit rien
 * d'utilisable (WCAG 1.1.1). Les couleurs de mode ne sont jamais la seule
 * information : elles reprennent celles des tracés de la carte, où elles ont
 * déjà un libellé (WCAG 1.4.1).
 */
export function ModeBreakdown({ modeBreakdown, emittedGrams }: ModeBreakdownProps) {
  const summary = describeCarbonModes(modeBreakdown, emittedGrams);

  // Rien à répartir : le tableau de bord affiche déjà son invite « votre bilan
  // est encore vide », un cadre sans barre ne ferait que la répéter à vide.
  if (!summary) return null;

  return (
    <section
      aria-labelledby="impact-modes-title"
      className="rounded-lg border border-ink-200 bg-white p-4 shadow-card"
    >
      <h3 id="impact-modes-title" className="text-sm font-bold text-ink">
        Émissions par mode
      </h3>

      {/* La phrase que les technologies d'assistance annoncent à la place des barres. */}
      <p className="sr-only">{summary.description}</p>

      <ul aria-hidden="true" className="mt-3 flex flex-col gap-2">
        {summary.rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2 text-sm">
            <span className="w-5 shrink-0 text-center">{row.icon}</span>
            <span className="w-20 shrink-0 truncate text-ink-700">{row.label}</span>

            <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-muted">
              <span
                className="block h-full rounded-full"
                style={{ width: `${row.sharePercent}%`, backgroundColor: row.color }}
              />
            </span>

            <span className="w-20 shrink-0 text-right font-bold text-ink tabular-nums">
              {row.carbonLabel}
            </span>
            <span className="w-10 shrink-0 text-right text-ink-500 tabular-nums">
              {row.sharePercent}&nbsp;%
            </span>
          </li>
        ))}
      </ul>

      {/*
        La distance par mode n'est pas sur la planche mobile, mais elle est ce
        qui rend lisible une ligne à zéro gramme : sans elle, « Marche 0,0 kg »
        ressemble à un mode qu'on n'a pas emprunté, alors que c'est justement
        celui qui n'a rien coûté.
      */}
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-200 pt-3 text-xs text-ink-500">
        {summary.rows.map((row) => (
          <div key={`${row.key}:distance`} className="flex gap-1">
            <dt>
              <span aria-hidden="true">{row.icon}</span> {row.label}
            </dt>
            <dd className="font-bold text-ink-700">
              {row.distanceLabel} · {row.tripsLabel}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
