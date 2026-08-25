'use client';

import type { SearchHistoryEntry } from '@urbanflow/shared';

import { formatSearchDate } from '../../lib/format-search-date';

export interface RecentSearchesProps {
  /** Trajets récents, du plus récent au plus ancien. */
  entries: SearchHistoryEntry[];
  /** Rejoue un trajet : remplit les deux champs du formulaire. */
  onSelect: (entry: SearchHistoryEntry) => void;
}

/**
 * Trajets récents recliquables (UF-204 — F2), affichés sous les champs de saisie.
 *
 * ## Un rappel, pas un journal
 *
 * Chaque ligne est un **bouton**, pas un simple texte : le geste attendu est de
 * rejouer le trajet en un clic, et un bouton l'annonce aux lecteurs d'écran
 * comme au clavier (`Tab` puis `Entrée`). `type="button"` est indispensable —
 * le composant vit dans un `<form>`, et un bouton sans type soumettrait le
 * formulaire au lieu de remplir les champs.
 *
 * ## Ce que le bouton dit vraiment
 *
 * Visuellement, « Part-Dieu → Bellecour » se lit d'un coup d'œil. La flèche
 * étant décorative (`aria-hidden`), le `aria-label` reformule l'action en toutes
 * lettres : « Reprendre le trajet X vers Y, aujourd'hui 09:12 ». Sans cela, un
 * lecteur d'écran énoncerait deux adresses collées, sans dire ce qui se passera
 * au clic (C7 — WCAG 2.4.4).
 *
 * ## Absence assumée
 *
 * Sans entrée à montrer — compte neuf, session perdue, API muette — le composant
 * ne rend **rien**. Un encart « aucun trajet récent » n'apporterait aucune
 * information : l'utilisateur sait qu'il n'a rien cherché (C2/C5).
 */
export function RecentSearches({ entries, onSelect }: RecentSearchesProps) {
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="recent-searches-title" className="flex flex-col gap-1.5">
      <h2 id="recent-searches-title" className="text-xs font-semibold text-ink-500">
        Trajets récents
      </h2>

      <ul className="flex flex-col gap-1">
        {entries.map((entry) => {
          const when = formatSearchDate(entry.createdAt);

          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onSelect(entry)}
                aria-label={`Reprendre le trajet ${entry.from.label} vers ${entry.to.label}${
                  when ? `, ${when}` : ''
                }`}
                // Cible tactile de 44 px de haut (WCAG 2.5.5) obtenue par le
                // rembourrage, sans grossir le texte.
                className="flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left hover:bg-tint-blue focus-visible:bg-tint-blue"
              >
                <span aria-hidden="true" className="shrink-0 text-ink-500">
                  ↩
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">
                    {entry.from.label}
                    <span aria-hidden="true" className="text-ink-500">
                      {' → '}
                    </span>
                    {entry.to.label}
                  </span>
                </span>

                {when && (
                  <span aria-hidden="true" className="shrink-0 text-[11px] text-ink-500">
                    {when}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
