'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

import { formatPositionLabel } from '../../lib/geolocation';
import { LocateMe } from './locate-me';
import type { UserLocationState } from './use-user-location';

/**
 * Formulaire de recherche d'itinéraire (F2) — le calcul lui-même arrive avec
 * UF-2xx ; ce ticket (UF-202) y branche la géolocalisation consentie.
 *
 * Le point de départ est **pré-rempli** par « Me localiser » mais reste un champ
 * de texte ordinaire : l'utilisateur peut le corriger ou le remplacer par une
 * adresse, et un refus de géolocalisation ne retire rien au formulaire
 * (dégradation propre — recette 2 du ticket).
 *
 * Accessibilité (C7) : libellés explicites associés aux champs, aide reliée par
 * `aria-describedby`, retours de géolocalisation annoncés par `LocateMe`.
 */
export function PlannerForm({ location }: { location: UserLocationState }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Dernier libellé écrit par la géolocalisation : sert à ne jamais écraser une
  // saisie manuelle, et à savoir ce qu'on peut retirer quand la position est
  // effacée. En ref : c'est une trace de ce qu'on a fait, pas un état affiché.
  const autofilledRef = useRef<string | null>(null);
  const { position } = location;

  useEffect(() => {
    if (position) {
      const label = formatPositionLabel(position);
      autofilledRef.current = label;
      setFrom(label);
      return;
    }
    // Position effacée (C8) : on retire le libellé que **nous** avions posé, et
    // seulement lui — une adresse tapée entre-temps doit survivre.
    setFrom((current) => (current === autofilledRef.current ? '' : current));
    autofilledRef.current = null;
  }, [position]);

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

      <LocateMe location={location} />

      <div className="flex flex-col gap-1">
        <label htmlFor="from" className="font-medium">
          Départ
        </label>
        <input
          id="from"
          name="from"
          type="text"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
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
          value={to}
          onChange={(event) => setTo(event.target.value)}
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
