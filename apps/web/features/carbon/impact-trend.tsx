'use client';

import type { CarbonPeriodTotals } from '@urbanflow/shared';

import { barHeightPercent, bucketLabel } from '../../lib/carbon-summary';
import { formatCarbon } from '../../lib/format-carbon';

export interface ImpactTrendProps {
  /** Tranches de la période, de la plus ancienne à la plus récente. */
  buckets: readonly CarbonPeriodTotals[];
}

/**
 * « Évolution des émissions évitées » (UF-505) — la seconde visualisation de la
 * page « Mon impact », reprise du panneau homonyme de la maquette desktop.
 *
 * ```
 *  ▁▃▅█        Évolution du CO₂ évité
 *  │  ┌─┐
 *  │┌─┤ │      chaque barre = un quart de la période
 *  ├┤ │ │
 *  └┴─┴─┴───►
 *  29/07  5/08  12/08  20/08
 * ```
 *
 * ## Des barres, pas une courbe
 *
 * La maquette trace une ligne ; l'écran en rend des barres. Une courbe suggère
 * une grandeur **continue** échantillonnée — or il n'y a ici que quatre totaux
 * de tranches, et rien entre eux : la pente entre deux points ne décrirait aucun
 * trajet réel. Des barres disent ce que sont ces valeurs, quatre cumuls
 * distincts, et restent lisibles sur un écran de téléphone (C2) sans axe ni
 * grille. Un SVG ou une librairie de graphes n'apporteraient rien de plus ici,
 * et pèseraient sur le bundle (C5).
 *
 * ## Ce que la barre mesure
 *
 * Le CO₂ **évité**, pas émis. C'est la grandeur que la page met en avant, et la
 * seule dont une hausse est une bonne nouvelle — un graphique d'émissions qui
 * monte quand l'usager se déplace davantage à vélo enverrait le message inverse
 * de celui du produit.
 *
 * ## Accessibilité (C7)
 *
 * Le graphique entier est `aria-hidden` et doublé d'un **tableau** de mêmes
 * données, lisible par un lecteur d'écran comme au clavier (WCAG 1.1.1). Ce
 * n'est pas une alternative dégradée : c'est la même information, sous la forme
 * qui se lit sans voir. Une hauteur non nulle ne descend jamais sous 2 % pour
 * qu'une petite tranche reste visible plutôt que de ressembler à un trou.
 */
export function ImpactTrend({ buckets }: ImpactTrendProps) {
  const max = buckets.reduce((highest, bucket) => Math.max(highest, bucket.avoidedGrams), 0);

  return (
    <section
      aria-labelledby="impact-trend-title"
      className="rounded-lg border border-ink-200 bg-white p-4 shadow-card"
    >
      <h2 id="impact-trend-title" className="mb-1 font-bold text-ink">
        Évolution du CO₂ évité
      </h2>
      <p className="mb-3 text-xs text-ink-500">Chaque barre couvre un quart de la période.</p>

      {max === 0 ? (
        <p className="text-sm text-ink-500">
          Aucun trajet retenu sur la période&nbsp;: le graphique se remplira dès votre premier
          itinéraire choisi.
        </p>
      ) : (
        <>
          <div aria-hidden="true" className="flex h-32 items-end gap-2">
            {buckets.map((bucket) => (
              <div key={bucket.from} className="flex h-full flex-1 flex-col justify-end gap-1">
                <div
                  className="w-full rounded-t-md bg-primary"
                  style={{ height: `${barHeightPercent(bucket.avoidedGrams, max)}%` }}
                />
                <span className="text-center text-[0.65rem] leading-tight text-ink-500">
                  {bucketLabel(bucket)}
                </span>
              </div>
            ))}
          </div>

          {/*
            Même information que les barres, sous la forme qui se lit sans voir.
            `sr-only` plutôt que masqué en CSS : le tableau doit rester dans
            l'ordre de tabulation et l'arbre d'accessibilité (C7 — WCAG 1.1.1).
          */}
          <table className="sr-only">
            <caption>Évolution du CO₂ évité, par tranche de la période</caption>
            <thead>
              <tr>
                <th scope="col">Début de la tranche</th>
                <th scope="col">CO₂ évité</th>
                <th scope="col">Trajets retenus</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.from}>
                  <th scope="row">{bucketLabel(bucket)}</th>
                  <td>{formatCarbon(bucket.avoidedGrams)}</td>
                  <td>{bucket.tripsCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
