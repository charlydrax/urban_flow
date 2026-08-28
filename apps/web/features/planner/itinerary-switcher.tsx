'use client';

import type { Itinerary, ItinerarySortKey } from '@urbanflow/shared';

import { formatCarbon } from '../../lib/format-carbon';

/** Comment le serveur a classé la liste — annoncé tel qu'il l'a publié, jamais redéduit. */
const SORT_LABELS: Record<ItinerarySortKey, string> = {
  carbonAsc: 'classés par empreinte carbone croissante',
  durationAsc: 'classés par durée croissante',
};

export interface ItinerarySwitcherProps {
  itineraries: readonly Itinerary[];
  selectedId: string | null;
  sortedBy: ItinerarySortKey | null;
  onSelect: (itineraryId: string) => void;
}

/**
 * Sélecteur d'itinéraire à tracer (UF-403, recette 4 : « sélectionner un autre
 * itinéraire met à jour le tracé »).
 *
 * ## Périmètre volontairement étroit
 *
 * Ce n'est **pas** le panneau de résultats de la maquette — cartes détaillées,
 * pastilles de modes, prix, points gagnés, badge « Recommandé IA ». Celui-là est
 * l'objet du ticket UF-404, et le construire ici reviendrait à livrer deux
 * tickets sous un seul. Ce composant fournit le strict nécessaire pour que le
 * tracé soit *pilotable* : un choix, avec de quoi le faire en connaissance de
 * cause (durée, CO₂, résumé des modes).
 *
 * ## Un groupe de boutons radio, pas des boutons
 *
 * Choisir un itinéraire, c'est en désigner **un parmi plusieurs** et non
 * déclencher autant d'actions indépendantes. Le motif radio est ce qui le dit
 * aux technologies d'assistance, et il apporte gratuitement la navigation aux
 * flèches — au `Tab`, on entre dans le groupe et on en sort, sans le traverser
 * option par option (C7 — WCAG 4.1.2).
 *
 * L'état sélectionné se voit à la **bordure et au libellé** autant qu'à la
 * couleur de fond (WCAG 1.4.1).
 */
export function ItinerarySwitcher({
  itineraries,
  selectedId,
  sortedBy,
  onSelect,
}: ItinerarySwitcherProps) {
  if (itineraries.length === 0) return null;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-bold text-ink">
        Itinéraires proposés&nbsp;: {itineraries.length}
        {sortedBy && (
          <span className="ml-1 font-normal text-ink-500">— {SORT_LABELS[sortedBy]}</span>
        )}
      </legend>

      {itineraries.map((itinerary) => {
        const isSelected = itinerary.id === selectedId;
        return (
          <label
            key={itinerary.id}
            className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
              isSelected
                ? 'border-primary bg-tint-green font-semibold text-ink'
                : 'border-ink-200 bg-white text-ink-700'
            }`}
          >
            <span className="flex items-center gap-2">
              {/*
                Le bouton radio natif est conservé et visible : le masquer
                obligerait à réimplémenter le focus et la sémantique de groupe,
                pour un gain purement esthétique.
              */}
              <input
                type="radio"
                name="itinerary"
                value={itinerary.id}
                checked={isSelected}
                onChange={() => onSelect(itinerary.id)}
                className="accent-primary"
              />
              <span>
                {itinerary.summary}
                <span className="block text-xs font-normal text-ink-500">
                  {formatCarbon(itinerary.carbonGrams)}
                  {itinerary.accessible && ' · accessible PMR'}
                </span>
              </span>
            </span>
            <span className="shrink-0 font-display font-bold">{itinerary.durationMinutes} min</span>
          </label>
        );
      })}
    </fieldset>
  );
}
