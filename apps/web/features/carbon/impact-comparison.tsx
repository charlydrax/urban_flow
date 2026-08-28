'use client';

import type { CarbonPeriodTotals } from '@urbanflow/shared';

import { avoidedSharePercent } from '../../lib/carbon-summary';
import { formatCarbon } from '../../lib/format-carbon';

export interface ImpactComparisonProps {
  /** Totaux de la période affichée, tels que publiés par l'API. */
  totals: CarbonPeriodTotals;
}

/**
 * « Vos trajets vs tout en voiture » (UF-505) — la première des deux
 * visualisations de la page « Mon impact », reprise de la maquette mobile.
 *
 * ```
 * Vos trajets vs tout en voiture
 *   Vos émissions réelles
 *   ████▏                                        13,5 kg
 *   Si tout en voiture
 *   ██████████████████████████████████████████   56,3 kg
 *   ↓ 76 % d'émissions évitées grâce à vos choix
 * ```
 *
 * ## Deux barres, une seule échelle
 *
 * Les deux barres se mesurent à la **même** référence — le tout-voiture, qui est
 * toujours la plus grande des deux. C'est ce qui fait voir l'écart : deux barres
 * normalisées chacune sur elle-même rempliraient toutes les deux la largeur et
 * ne compareraient plus rien.
 *
 * ## Pourquoi cette comparaison plutôt qu'un chiffre seul
 *
 * « 13,5 kg » ne dit à personne s'il a bien ou mal fait. En face des 56,3 kg
 * qu'aurait coûtés le même mois en voiture, le chiffre devient un résultat.
 * C'est la proposition de valeur écologique du produit, et la raison pour
 * laquelle la référence voiture est stockée trajet par trajet plutôt que
 * recalculée.
 *
 * ## Accessibilité (C7)
 *
 * Les barres sont décoratives (`aria-hidden`) : chaque valeur est déjà écrite en
 * toutes lettres à côté, et l'écart est énoncé par une phrase complète. Rien
 * n'est porté par la seule longueur d'un rectangle ni par la seule couleur
 * (WCAG 1.4.1) — le rouge de la barre voiture est doublé du mot « voiture », le
 * vert du mot « vos émissions ».
 */
export function ImpactComparison({ totals }: ImpactComparisonProps) {
  const share = avoidedSharePercent(totals);

  // Le tout-voiture est l'échelle. À zéro (aucun trajet valorisé), les deux
  // barres tombent à zéro plutôt que de diviser par zéro.
  const scale = totals.carEquivalentGrams;
  const realWidth = scale > 0 ? Math.round((totals.emittedGrams / scale) * 100) : 0;

  return (
    <section
      aria-labelledby="impact-comparison-title"
      className="rounded-lg border border-ink-200 bg-white p-4 shadow-card"
    >
      <h2 id="impact-comparison-title" className="mb-3 font-bold text-ink">
        Vos trajets vs tout en voiture
      </h2>

      <dl className="flex flex-col gap-3">
        <div>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <dt className="text-ink-700">Vos émissions réelles</dt>
            <dd className="shrink-0 font-bold text-ink">{formatCarbon(totals.emittedGrams)}</dd>
          </div>
          <div aria-hidden="true" className="mt-1 h-3 overflow-hidden rounded-full bg-tint-neutral">
            <div className="h-full rounded-full bg-primary" style={{ width: `${realWidth}%` }} />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <dt className="text-ink-700">Si tout en voiture</dt>
            <dd className="shrink-0 font-bold text-ink">
              {formatCarbon(totals.carEquivalentGrams)}
            </dd>
          </div>
          <div aria-hidden="true" className="mt-1 h-3 overflow-hidden rounded-full bg-tint-neutral">
            {/*
              La référence occupe toute la largeur par construction : c'est elle
              l'échelle, et elle est toujours ≥ aux émissions réelles.
            */}
            <div className="h-full w-full rounded-full bg-error" />
          </div>
        </div>
      </dl>

      {share === null ? (
        <p className="mt-3 text-sm text-ink-500">
          Choisissez un itinéraire après une recherche pour commencer à mesurer vos économies.
        </p>
      ) : (
        <p className="mt-3 text-sm font-bold text-primary-dark">
          <span aria-hidden="true">↓ </span>
          {share}&nbsp;% d’émissions évitées grâce à vos choix
        </p>
      )}
    </section>
  );
}
