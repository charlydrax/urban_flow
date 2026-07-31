'use client';

import { useState } from 'react';

import { AddressAutocomplete, type TripPoint } from './address-autocomplete';

export interface TripFieldsProps {
  from: TripPoint;
  to: TripPoint;
  onFromChange: (next: TripPoint) => void;
  onToChange: (next: TripPoint) => void;
  onSwap: () => void;
  /** Complément affiché sous « Départ » quand il vient de la géolocalisation. */
  fromHint?: string;
}

/**
 * Bloc départ/arrivée du planificateur (UF-203 — F2).
 *
 * Reproduit la carte de la maquette Figma « 4. PLANIFICATEUR F2 » : les deux
 * champs sont **empilés dans un seul cadre** séparé par un filet, et non posés
 * comme deux champs indépendants — c'est ce qui les donne à lire comme un
 * trajet, une origine et une destination, plutôt que comme deux saisies sans
 * rapport. Le bouton d'inversion vit sur la ligne « Départ », à droite.
 *
 * Écart assumé à la maquette (C7) : la double-flèche y est en Ink 300, un gris
 * trop clair pour un élément **interactif** (WCAG 1.4.11 exige 3:1). Elle est
 * remontée en Ink 500, qui tient le contraste sans changer l'intention visuelle.
 *
 * Cible tactile (C2/C7) : le bouton mesure 44 × 44 px, minimum WCAG 2.5.5, alors
 * que le glyphe n'en fait que 15 — la zone cliquable dépasse volontairement le
 * dessin.
 */
export function TripFields({
  from,
  to,
  onFromChange,
  onToChange,
  onSwap,
  fromHint,
}: TripFieldsProps) {
  // Une inversion ne change rien de visible pour un lecteur d'écran : les deux
  // champs gardent leur libellé, seul leur contenu permute. On l'annonce donc.
  const [swapAnnouncement, setSwapAnnouncement] = useState('');

  const handleSwap = () => {
    onSwap();
    // La chaîne doit *changer* pour être réannoncée deux fois de suite.
    setSwapAnnouncement((current) =>
      current.endsWith('.') ? 'Départ et arrivée inversés' : 'Départ et arrivée inversés.',
    );
  };

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <AddressAutocomplete
        label="Départ"
        hint={fromHint}
        tone="origin"
        value={from}
        onChange={onFromChange}
        placeholder="Ex. rue de la Part-Dieu"
        trailing={
          <button
            type="button"
            onClick={handleSwap}
            aria-label="Inverser le départ et l’arrivée"
            title="Inverser le départ et l’arrivée"
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-xl leading-none text-ink-500 hover:bg-surface-muted hover:text-ink"
          >
            <span aria-hidden="true">⇅</span>
          </button>
        }
      />

      {/* Filet aligné sous les libellés, comme sur la maquette (retrait de la pastille). */}
      <div className="my-2 ml-[19px] h-px bg-ink-200" />

      <AddressAutocomplete
        label="Arrivée"
        tone="destination"
        value={to}
        onChange={onToChange}
        placeholder="Ex. place Bellecour"
      />

      <p role="status" className="sr-only">
        {swapAnnouncement}
      </p>
    </div>
  );
}
