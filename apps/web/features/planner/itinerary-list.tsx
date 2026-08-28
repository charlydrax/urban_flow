'use client';

import type { Itinerary, ItinerarySortKey } from '@urbanflow/shared';

import { BEST_OPTION_REASON } from '../../lib/itinerary-cards';
import { ItineraryCard } from './itinerary-card';

/** Comment le serveur a classé la liste — annoncé tel qu'il l'a publié, jamais redéduit. */
const SORT_LABELS: Record<ItinerarySortKey, string> = {
  carbonAsc: 'classés par empreinte carbone croissante',
  durationAsc: 'classés par durée croissante',
};

export interface ItineraryListProps {
  itineraries: readonly Itinerary[];
  selectedId: string | null;
  sortedBy: ItinerarySortKey | null;
  onSelect: (itineraryId: string) => void;
}

/**
 * Panneau de résultats du planificateur (UF-404) — la liste de cartes qui
 * permet de **comparer** les options et d'en choisir une.
 *
 * Remplace `itinerary-switcher.tsx`, que UF-403 avait livré comme strict
 * minimum pour rendre le tracé pilotable en attendant ce ticket.
 *
 * ## Un groupe de boutons radio, pas une liste de boutons
 *
 * Choisir un itinéraire, c'est en désigner **un parmi plusieurs** et non
 * déclencher autant d'actions indépendantes. Le motif radio est ce qui le dit
 * aux technologies d'assistance, et il apporte gratuitement la navigation aux
 * flèches — au `Tab` on entre dans le groupe et on en sort, sans le traverser
 * option par option (C7 — WCAG 4.1.2). Avec quatre cartes de six lignes
 * chacune, la différence à la navigation clavier n'est pas théorique.
 *
 * ## Le lien avec la carte
 *
 * Sélectionner une carte remonte l'identifiant à `PlannerScreen`, qui le passe
 * à la carte : `use-route-overlay` repousse alors la même source GeoJSON avec un
 * `selected` différent, met l'itinéraire retenu en avant, estompe les autres et
 * recadre dessus. Le composant ne touche jamais MapLibre — c'est la recette 2 du
 * ticket, obtenue sans coupler la liste au moteur de rendu.
 *
 * ## Mobile-first (C2)
 *
 * Les cartes s'empilent sur toute la largeur et ne dépendent d'aucun point de
 * rupture : c'est la mise en page de la maquette mobile. À partir de `md`, la
 * colonne du planificateur les contient telles quelles, à côté de la carte —
 * rien à réorganiser, seule la largeur du conteneur change.
 *
 * Le vide, l'attente et le mode dégradé sont gérés par `PlannerScreen`
 * (UF-405) : cette liste rend `null` plutôt qu'un cadre creux, et n'a pas à
 * savoir *pourquoi* elle est vide — « aucun trajet » et « aucune source n'a
 * répondu » ne se disent pas pareil, mais cela se décide au-dessus d'elle.
 */
export function ItineraryList({ itineraries, selectedId, sortedBy, onSelect }: ItineraryListProps) {
  if (itineraries.length === 0) return null;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-bold text-ink">
        Itinéraires proposés&nbsp;: {itineraries.length}
        {sortedBy && (
          <span className="ml-1 font-normal text-ink-500">— {SORT_LABELS[sortedBy]}</span>
        )}
      </legend>

      {itineraries.map((itinerary, index) => (
        <ItineraryCard
          key={itinerary.id}
          itinerary={itinerary}
          position={index + 1}
          total={itineraries.length}
          selected={itinerary.id === selectedId}
          // La mise en avant du premier n'est pas décorative : elle dit
          // *pourquoi* il est premier, et cette raison vient du serveur. Sans
          // `sortedBy`, on ne l'invente pas.
          bestReason={index === 0 && sortedBy ? BEST_OPTION_REASON[sortedBy] : null}
          onSelect={() => onSelect(itinerary.id)}
        />
      ))}
    </fieldset>
  );
}
