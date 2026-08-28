'use client';

import type { ItinerarySortKey } from '@urbanflow/shared';

import { SORT_OPTIONS } from '../../lib/itinerary-cards';

export interface ItinerarySortToggleProps {
  /** Clé de tri actuellement appliquée à l'affichage. */
  value: ItinerarySortKey;
  /** Clé publiée par le serveur — celle sur laquelle la liste s'est ouverte. */
  serverDefault: ItinerarySortKey;
  onChange: (sortKey: ItinerarySortKey) => void;
}

/**
 * Sélecteur de tri du panneau de résultats (UF-503, recette 3).
 *
 * ## Un retri, pas une nouvelle recherche
 *
 * La bascule ne déclenche **aucun appel réseau** : elle réordonne les cinq
 * itinéraires déjà reçus. Repasser par `POST /routes/plan` relancerait la
 * collecte des trois sources — plusieurs secondes — et pourrait rendre des
 * itinéraires *différents*, alors qu'on demande seulement à lire les mêmes dans
 * un autre ordre. C'est aussi la lecture éco-conception du geste : zéro requête
 * pour un changement de vue (C5).
 *
 * ## Pourquoi il ne devient jamais le défaut
 *
 * Le ticket demande que le retri par durée reste possible « sans en faire le
 * défaut ». Trois choses le garantissent, et aucune n'est un réglage à
 * respecter de bonne foi :
 *
 * 1. le choix vit dans l'état local du panneau — ni `localStorage`, ni profil,
 *    ni paramètre d'URL ;
 * 2. il est **repris au tri du serveur** à chaque nouvelle recherche
 *    (`ItineraryList` remet la vue à `sortedBy` quand celui-ci change) ;
 * 3. « Écologique » est le premier bouton du groupe, donc le premier atteint au
 *    clavier — l'ordre de lecture dit lequel est proposé et lequel est une
 *    alternative.
 *
 * ## Deux boutons radio, pas deux boutons
 *
 * Choisir un tri, c'est retenir **une** option parmi deux qui s'excluent : le
 * motif radio le dit aux technologies d'assistance et donne la navigation aux
 * flèches, là où deux `<button>` laisseraient croire à deux actions
 * indépendantes (C7 — WCAG 4.1.2).
 *
 * Le radio natif est masqué visuellement — mais **pas** retiré du flux (`peer`,
 * `sr-only`) : il garde le focus clavier, et l'anneau de focus est repeint sur
 * l'étiquette qui le suit. L'état retenu se lit au fond plein *et* au texte en
 * gras, jamais à la seule couleur (WCAG 1.4.1).
 *
 * Couvre : C2 (le groupe passe à la ligne sous la légende sur écran étroit),
 * C5 (retri en mémoire, aucune requête), C7 (radiogroup, focus visible,
 * redondance de l'état retenu).
 */
export function ItinerarySortToggle({ value, serverDefault, onChange }: ItinerarySortToggleProps) {
  return (
    <fieldset className="flex items-center gap-1 rounded-full bg-surface-muted p-1">
      <legend className="sr-only">Trier les itinéraires</legend>

      {SORT_OPTIONS.map((option) => {
        const active = option.key === value;

        return (
          <span key={option.key} className="contents">
            <input
              type="radio"
              id={`itinerary-sort-${option.key}`}
              name="itinerary-sort"
              value={option.key}
              checked={active}
              onChange={() => onChange(option.key)}
              className="peer sr-only"
            />
            <label
              htmlFor={`itinerary-sort-${option.key}`}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-action ${
                active
                  ? 'bg-white font-bold text-ink shadow-card'
                  : 'font-medium text-ink-500 hover:text-ink'
              }`}
            >
              <span aria-hidden="true">{option.icon} </span>
              {option.label}
              {/*
                Le tri du serveur est signalé comme tel : sans cette mention, un
                usager qui a basculé sur « Rapide » n'aurait plus aucun moyen de
                savoir lequel des deux est le classement d'origine.
              */}
              {option.key === serverDefault && <span className="sr-only"> (tri par défaut)</span>}
            </label>
          </span>
        );
      })}
    </fieldset>
  );
}
