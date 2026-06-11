'use client';

import { FormEvent } from 'react';

/**
 * Formulaire de recherche d'itinéraire (F2) — STUB squelette, non câblé.
 *
 * Implémentation cible : bouton « Me localiser » (lib/geolocation — C6, après
 * consentement explicite C8), appel `apiClient.planRoutes`, affichage de la
 * liste triée par CO₂ croissant + tracés sur la carte.
 *
 * Accessibilité (C7) : labels explicites associés aux champs, messages
 * d'erreur reliés par aria-describedby (à venir avec la validation).
 */
export function PlannerForm() {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // TODO(F2): apiClient.planRoutes({ from, to, userId }) + rendu des résultats
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-describedby="planner-help"
      className="flex flex-col gap-4 rounded-lg border border-primary/20 bg-white p-4"
    >
      <p id="planner-help" className="text-sm">
        Saisissez un départ et une arrivée pour comparer les options de transport.
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="from" className="font-medium">
          Départ
        </label>
        <input
          id="from"
          name="from"
          type="text"
          placeholder="Ex. Part-Dieu"
          autoComplete="off"
          className="rounded border border-primary/40 px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="to" className="font-medium">
          Arrivée
        </label>
        <input
          id="to"
          name="to"
          type="text"
          placeholder="Ex. Bellecour"
          autoComplete="off"
          className="rounded border border-primary/40 px-3 py-2"
        />
      </div>

      <button
        type="submit"
        className="rounded bg-primary px-4 py-2 font-medium text-white hover:bg-primary-dark"
      >
        Comparer les itinéraires
      </button>
    </form>
  );
}
