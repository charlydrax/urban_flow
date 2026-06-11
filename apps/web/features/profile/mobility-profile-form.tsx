'use client';

import { FormEvent } from 'react';

/** Options de modes présentées à l'utilisateur (libellés FR — UI en français). */
const MODE_OPTIONS = [
  { value: 'WALK', label: 'Marche' },
  { value: 'BIKE', label: 'Vélo' },
  { value: 'SCOOTER', label: 'Trottinette' },
  { value: 'BUS', label: 'Bus' },
  { value: 'TRAM', label: 'Tramway' },
  { value: 'METRO', label: 'Métro' },
  { value: 'CARPOOL', label: 'Covoiturage' },
] as const;

/**
 * Formulaire des préférences de mobilité (F1) — STUB squelette, non câblé.
 *
 * Implémentation cible : GET/PUT /api/users/me/mobility-profile via apiClient.
 * Le choix « accessibilité PMR » pilote les itinéraires accessibles (C12) ;
 * c'est une donnée sensible : collectée avec consentement et minimisée (C8).
 *
 * Accessibilité (C7) : fieldset/legend pour le groupe de cases à cocher.
 */
export function MobilityProfileForm() {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // TODO(F1): apiClient PUT /users/me/mobility-profile
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex max-w-md flex-col gap-4 rounded-lg border border-primary/20 bg-white p-4"
    >
      <h2 className="text-lg font-bold text-primary-dark">Mes préférences de mobilité</h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Modes de transport acceptés</legend>
        {MODE_OPTIONS.map((mode) => (
          <label key={mode.value} className="flex items-center gap-2">
            <input type="checkbox" name="preferredModes" value={mode.value} />
            {mode.label}
          </label>
        ))}
      </fieldset>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="reducedMobility" />
        Itinéraires accessibles PMR uniquement
      </label>

      <div className="flex flex-col gap-1">
        <label htmlFor="max-walk" className="font-medium">
          Marche maximale par trajet (minutes)
        </label>
        <input
          id="max-walk"
          name="maxWalkMinutes"
          type="number"
          min={0}
          max={60}
          defaultValue={15}
          className="w-24 rounded border border-primary/40 px-3 py-2"
        />
      </div>

      <button
        type="submit"
        className="rounded bg-primary px-4 py-2 font-medium text-white hover:bg-primary-dark"
      >
        Enregistrer
      </button>
    </form>
  );
}
