'use client';

import type { Itinerary } from '@urbanflow/shared';

import { describeCarbonBreakdown } from '../../lib/carbon-breakdown';

export interface CarbonBreakdownProps {
  /** Itinéraire retenu dans le panneau de résultats. */
  itinerary: Itinerary;
}

/**
 * Détail de l'empreinte carbone de l'itinéraire sélectionné (UF-501) — ce qui
 * transforme « 392 g CO₂ » en une explication.
 *
 * ```
 * ▸ D'où vient cette empreinte ?               392 g CO₂
 *   ┌────────────────────────────────────────────────────┐
 *   │ 🚶 Marche   Part-Dieu → Saxe            400 m       │
 *   │ ▏                                0 g/km · 0 g CO₂   │
 *   │ 🚌 Bus C3   Saxe → Bellecour            4,0 km      │
 *   │ ███████████████████████████     95 g/km · 380 g CO₂ │
 *   └────────────────────────────────────────────────────┘
 *   🚗 Seul en voiture : 1,2 kg CO₂ — vous en évitez 785 g (67 %)
 * ```
 *
 * ## Replié par défaut
 *
 * Le panneau de résultats sert à **comparer** des options ; le détail d'une
 * seule ne doit pas repousser les autres hors de l'écran (C2). Un `<details>`
 * natif porte cet état sans une ligne de JavaScript, et donne gratuitement
 * l'ouverture au clavier et l'annonce « développé / réduit » aux technologies
 * d'assistance — un `<button>` maison aurait fallu recâbler `aria-expanded`.
 *
 * ## Hors de la carte de résultat, pas dedans
 *
 * Une carte est un `<label>` de bouton radio : y imbriquer un `<summary>`
 * cliquable ferait basculer la sélection à chaque ouverture du détail. Le
 * panneau vit donc **sous** la liste et suit la sélection, ce qui a un second
 * mérite — un seul détail ouvert à la fois, celui qui intéresse.
 *
 * ## Le facteur est affiché
 *
 * « 95 g/km » à côté de « 380 g CO₂ » : le chiffre se refait de tête, sur 4 km.
 * Sans lui, l'empreinte est à croire sur parole — et c'est la promesse d'un
 * calcul carbone transparent qui tombe.
 *
 * Couvre : C7 (barres en `aria-hidden` doublées d'une phrase énoncée, contraste
 * des couleurs de mode au seuil des objets graphiques), C2 (empilement mobile,
 * replié par défaut), C5 (aucun recalcul côté client).
 */
export function CarbonBreakdown({ itinerary }: CarbonBreakdownProps) {
  const breakdown = describeCarbonBreakdown(itinerary);

  // Un itinéraire sans détail (réponse d'un cache antérieur au ticket) ne
  // justifie pas un cadre vide : la carte affiche déjà son total.
  if (!breakdown) return null;

  return (
    <details className="rounded-lg border border-ink-200 bg-white text-sm shadow-card">
      <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 font-bold text-ink">
        <span>D’où vient cette empreinte&nbsp;?</span>
        <span aria-hidden="true" className="font-normal text-primary-dark">
          {breakdown.totalLabel}
        </span>
      </summary>

      {/*
        Le contenu visuel est un empilement de barres et de fragments chiffrés :
        énoncé tel quel, il donnerait « Bus C3, 4,0 km, 95 g/km, 380 g CO₂ »
        sans verbe ni contexte. La phrase complète est lue à sa place, et lui
        seul est exposé aux technologies d'assistance (C7 — WCAG 1.1.1).
      */}
      <p className="sr-only">{breakdown.description}</p>

      <div aria-hidden="true" className="flex flex-col gap-3 px-3 pb-3">
        <ol className="flex flex-col gap-2">
          {breakdown.rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold text-ink-700">
                  {/*
                    Pastille colorée plutôt que texte coloré : les couleurs de
                    modes de la charte sont validées à 3:1 (objets graphiques),
                    pas aux 4.5:1 du texte courant — même règle que la carte de
                    résultat.
                  */}
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  {row.icon} {row.label}
                </span>
                <span className="shrink-0 font-bold text-primary-dark">{row.carbonLabel}</span>
              </div>

              {/*
                Barre de contribution. Purement indicative : la valeur exacte est
                déjà écrite au-dessus, la barre ne sert qu'à faire voir d'un coup
                d'œil quel maillon pèse.
              */}
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-200">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${row.sharePercent}%`, backgroundColor: row.color }}
                />
              </div>

              <div className="flex flex-wrap justify-between gap-x-2 text-xs text-ink-500">
                <span>{row.route}</span>
                <span>
                  {row.distanceLabel} · {row.factorLabel}
                </span>
              </div>
            </li>
          ))}
        </ol>

        {breakdown.comparison && (
          <p className="rounded-md bg-tint-green px-3 py-2 text-xs text-primary-dark">
            🚗 Seul en voiture&nbsp;: <b>{breakdown.comparison.carLabel}</b> — vous en évitez{' '}
            <b>{breakdown.comparison.avoidedLabel}</b> ({breakdown.comparison.avoidedPercent}
            &nbsp;%).
          </p>
        )}

        {/*
          La source n'est pas une mention légale décorative : un barème carbone
          non sourcé n'engage personne, et c'est sur lui que l'app demande à
          l'usager de changer ses habitudes.
        */}
        <p className="text-xs text-ink-500">
          Facteurs d’émission&nbsp;: ordres de grandeur de la Base Empreinte de l’ADEME, en
          g&nbsp;CO₂e par passager et par kilomètre.
        </p>
      </div>
    </details>
  );
}
