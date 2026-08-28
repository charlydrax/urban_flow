'use client';

/** Nombre de cartes esquissées — l'API en rend rarement moins de trois (UF-401). */
const PLACEHOLDER_COUNT = 3;

/**
 * Esquisse du panneau de résultats pendant le calcul (UF-405).
 *
 * ## Pourquoi un squelette plutôt qu'un spinner
 *
 * Le calcul dure le temps de la source la plus lente — de l'ordre de deux à
 * huit secondes selon la charge d'OpenTripPlanner. Un spinner laisserait la
 * colonne s'effondrer puis se remplir d'un coup : la carte à droite sauterait,
 * et l'usager perdrait le fil de ce qu'il regardait. Le squelette **réserve la
 * place** des cartes à venir, aux mêmes dimensions, et la mise en page ne bouge
 * plus une fois la réponse arrivée (C2, et pas de reflow inutile — C5).
 *
 * Aucune image, aucune animation coûteuse : trois blocs et une pulsation CSS,
 * qui ne repeint que l'opacité (C5).
 *
 * ## Pourquoi il est muet
 *
 * `aria-hidden` : l'attente est **déjà** annoncée par le formulaire, dont le
 * bouton passe à « Calcul en cours… » et double le changement d'un
 * `role="status"`. Deux régions vivantes qui parlent de la même attente la font
 * énoncer deux fois (C7 — WCAG 4.1.3). Le squelette est une information
 * visuelle, et rien d'autre.
 */
export function ItinerarySkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="h-5 w-2/3 animate-pulse rounded bg-ink-200" />
      {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
        <div
          key={index}
          className="flex animate-pulse flex-col gap-3 rounded-lg border border-ink-200 bg-white p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="h-4 w-1/3 rounded bg-ink-200" />
            <div className="h-5 w-16 rounded bg-ink-200" />
          </div>
          <div className="h-4 w-4/5 rounded bg-ink-200" />
          <div className="h-3 w-3/5 rounded bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}
