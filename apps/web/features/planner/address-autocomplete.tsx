'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { formatCoordinates } from '../../lib/geolocation';
import type { GeocodedPlace } from '../../lib/geocoding';
import { useAddressSearch } from './use-address-search';

/**
 * Un point du trajet tel que le formulaire le manipule.
 *
 * `text` et `place` sont **volontairement dissociés** : l'utilisateur peut taper
 * n'importe quoi (`place === null`, aucune coordonnée connue), et seule la
 * sélection d'une suggestion fixe le couple lat/lng. Cette distinction est ce
 * qui permet au formulaire de savoir s'il tient un vrai point géocodé ou une
 * simple chaîne — la recette 2 du ticket.
 */
export interface TripPoint {
  /** Texte affiché dans le champ. */
  text: string;
  /** Adresse résolue, ou `null` tant qu'aucune suggestion n'a été choisie. */
  place: GeocodedPlace | null;
  /**
   * Vrai quand le point a été posé par « Me localiser » et non tapé (UF-202).
   * Sert à ne réécrire que nos propres libellés, jamais une saisie manuelle.
   */
  autofilled?: boolean;
}

/** Point vide — valeur initiale et remise à zéro. */
export const EMPTY_TRIP_POINT: TripPoint = { text: '', place: null };

/**
 * Pastille de la maquette : départ cerclé de bleu « Rhône », arrivée pleine en
 * vert « Saône ». La forme (creux / plein) double la couleur, pour rester
 * distinguable en cas de daltonisme (C7 — WCAG 1.4.1).
 */
const DOT_CLASSES: Record<'origin' | 'destination', string> = {
  origin: 'border-[2.5px] border-action bg-white',
  destination: 'border-[2.5px] border-primary bg-primary',
};

export interface AddressAutocompleteProps {
  /** Libellé du champ — « Départ » ou « Arrivée ». */
  label: string;
  /** Valeur courante, détenue par le formulaire. */
  value: TripPoint;
  /** Remonte toute modification (frappe, sélection, effacement). */
  onChange: (next: TripPoint) => void;
  /** Rôle du point : détermine la pastille de la maquette. */
  tone: 'origin' | 'destination';
  placeholder?: string;
  /** Complément affiché sous le libellé — ex. « position actuelle » (maquette). */
  hint?: string;
  /** Élément posé à droite du champ — le bouton d'inversion sur la ligne « Départ ». */
  trailing?: ReactNode;
}

/**
 * Champ d'adresse avec autocomplétion (UF-203 — F2).
 *
 * Reprend le bloc de saisie de la maquette Figma « 4. PLANIFICATEUR F2 » :
 * pastille, libellé secondaire, valeur en gras, liste de suggestions.
 *
 * ## Motif ARIA « combobox » (C7 — WCAG 2.1 AA)
 *
 * Le champ est un `combobox` relié à une `listbox` : l'état ouvert/fermé
 * (`aria-expanded`), la liste (`aria-controls`) et l'option courante
 * (`aria-activedescendant`) sont annoncés. Le **focus ne quitte jamais le
 * champ** — c'est ce qui permet de continuer à taper pendant que la liste
 * défile, et ce qui évite de piéger un utilisateur au clavier.
 *
 * Clavier : `↓`/`↑` parcourent (avec bouclage), `Entrée` valide, `Échap` ferme
 * sans rien changer. Un `role="status"` visuellement masqué annonce le nombre de
 * suggestions à chaque changement, car une liste qui apparaît en silence est
 * invisible pour un lecteur d'écran.
 *
 * ## Éco-conception (C5)
 *
 * La recherche n'est active que tant qu'aucune suggestion n'a été choisie
 * (`enabled`) : réafficher le libellé sélectionné ne relance pas d'appel, et
 * refermer puis rouvrir la liste réutilise les suggestions déjà en mémoire.
 */
export function AddressAutocomplete({
  label,
  value,
  onChange,
  tone,
  placeholder,
  hint,
  trailing,
}: AddressAutocompleteProps) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;

  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Une adresse déjà résolue n'a plus rien à chercher : c'est ce qui empêche le
  // libellé qu'on vient d'écrire dans le champ de relancer une requête.
  const { status, suggestions, message } = useAddressSearch(value.text, value.place === null);

  const showList = isOpen && status === 'results' && suggestions.length > 0;
  const showPanel = isOpen && (status === 'empty' || status === 'error');

  // La liste a changé sous le curseur : on repart de « aucune option active »
  // plutôt que de laisser un index pointer sur une suggestion disparue.
  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestions]);

  const select = (place: GeocodedPlace) => {
    onChange({ text: place.label, place });
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === 'Enter' && showList && activeIndex >= 0) {
      // Sans cela, « Entrée » soumettrait le formulaire au lieu de valider
      // la suggestion survolée au clavier.
      event.preventDefault();
      select(suggestions[activeIndex]);
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (suggestions.length === 0) return;

    // Les flèches pilotent la liste, pas le curseur dans le texte.
    event.preventDefault();
    if (!isOpen) {
      setIsOpen(true);
      setActiveIndex(event.key === 'ArrowDown' ? 0 : suggestions.length - 1);
      return;
    }
    // Bouclage : arrivé en bas, on revient en haut — plus rapide que de
    // remonter toute la liste.
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    setActiveIndex((current) => (current + delta + suggestions.length) % suggestions.length);
  };

  return (
    <div className="relative flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`size-[9px] shrink-0 rounded-full ${DOT_CLASSES[tone]}`}
      />

      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="block text-xs text-ink-500">
          {label}
          {hint && <span className="text-ink-500"> · {hint}</span>}
        </label>

        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          // `off` ne suffit plus sur Chrome : `new-password` est le seul moyen
          // fiable d'écarter l'autoremplissage natif, qui recouvrirait la liste.
          autoComplete="new-password"
          enterKeyHint="search"
          type="text"
          value={value.text}
          placeholder={placeholder}
          onChange={(event) => {
            // Toute frappe invalide la résolution précédente : on repart d'un
            // point sans coordonnées, sinon le formulaire enverrait le lat/lng
            // d'une adresse que l'utilisateur vient de réécrire.
            onChange({ text: event.target.value, place: null });
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-[15px] font-bold text-ink placeholder:font-normal placeholder:text-placeholder focus:outline-none"
        />

        {value.place && (
          // Transparence (C6/C8) : ce qui sera réellement envoyé au calcul
          // d'itinéraire est écrit en clair, comme la position de UF-202.
          <p className="truncate text-[11px] text-ink-500">
            {value.place.context && <span>{value.place.context} · </span>}
            {formatCoordinates(value.place)}
          </p>
        )}

        {/* Annonce silencieuse du nombre de suggestions (WCAG 4.1.3). */}
        <p role="status" className="sr-only">
          {showList
            ? `${suggestions.length} suggestion${suggestions.length > 1 ? 's' : ''} pour ${label}.`
            : ''}
        </p>
      </div>

      {trailing}

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`Suggestions d’adresses pour ${label}`}
          className="absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-md border border-ink-200 bg-white shadow-raised"
        >
          {suggestions.map((place, index) => (
            <li
              key={place.id}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              // `onMouseDown` plutôt que `onClick` : le clic déclencherait
              // d'abord le `blur` du champ, qui fermerait la liste avant que
              // la sélection n'arrive. `preventDefault` garde le focus en place.
              onMouseDown={(event) => {
                event.preventDefault();
                select(place);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`cursor-pointer px-3 py-2.5 text-sm ${
                index === activeIndex ? 'bg-tint-blue text-ink' : 'text-ink'
              }`}
            >
              <span className="flex items-start gap-2">
                <span aria-hidden="true" className="text-ink-500">
                  📍
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{place.label}</span>
                  {place.context && (
                    <span className="block truncate text-xs text-ink-500">{place.context}</span>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {showPanel && (
        <p
          role={status === 'error' ? 'alert' : 'status'}
          className={`absolute top-full right-0 left-0 z-20 mt-1 rounded-md border border-ink-200 bg-white px-3 py-2.5 text-xs shadow-raised ${
            status === 'error' ? 'font-semibold text-error' : 'text-ink-500'
          }`}
        >
          {status === 'error'
            ? message
            : 'Aucune adresse trouvée dans la métropole de Lyon. La recherche porte sur les adresses : essayez « place Bellecour » plutôt que « Bellecour », ou ajoutez la commune.'}
        </p>
      )}
    </div>
  );
}
