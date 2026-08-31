'use client';

import type { Itinerary } from '@urbanflow/shared';

import { modeSequence } from '../../lib/itinerary-cards';

export interface StartNavigationProps {
  itinerary: Itinerary;
  /** `true` entre le clic et l'arrivée de la position (portail de consentement ouvert). */
  awaitingConsent: boolean;
  onStart: (itinerary: Itinerary) => void;
}

/**
 * Bouton « Démarrer » de l'itinéraire retenu (UF-806) — le maillon qui manquait
 * entre le choix d'une option et le guidage.
 *
 * ## Pourquoi il est sous la liste, et pas dans la carte de résultat
 *
 * Une carte de résultat est un `<label>` de bouton radio (UF-404) : tout clic
 * dedans change la sélection. Y imbriquer un bouton d'action ferait, sur
 * certains navigateurs, changer l'option **et** lancer le guidage d'un seul
 * geste — et sur les autres, un bouton qui avale un clic destiné au `<label>`
 * qui l'entoure. Le bouton vit donc à côté de la liste, comme le détail carbone
 * (`CarbonBreakdown`), et porte le nom de l'option qu'il lancera.
 *
 * ## Invité comme connecté (recette 1)
 *
 * Aucune condition de session : le guidage n'écrit rien côté serveur, il
 * n'interroge rien, il lit un itinéraire déjà reçu et une position déjà
 * consentie. Le réserver aux comptes reviendrait à refermer sur le guidage la
 * porte qu'UF-801 a ouverte sur le planificateur.
 *
 * Couvre : C2 (cible tactile pleine largeur ≥ 44 px), C7 (le libellé accessible
 * nomme l'itinéraire lancé, l'état d'attente est annoncé, pas seulement grisé).
 */
export function StartNavigation({ itinerary, awaitingConsent, onStart }: StartNavigationProps) {
  const legs = modeSequence(itinerary);
  const summary = legs.map((leg) => leg.label.toLowerCase()).join(', ');

  return (
    <button
      type="button"
      onClick={() => onStart(itinerary)}
      disabled={awaitingConsent}
      // `aria-label` plutôt que le seul texte visible : « Démarrer » ne dit pas
      // *quoi*, et un lecteur d'écran qui parcourt les boutons de la page
      // l'entendrait hors du contexte de la liste (C7 — WCAG 2.4.6).
      aria-label={`Démarrer la navigation sur l’itinéraire ${itinerary.durationMinutes} minutes : ${summary}`}
      className="min-h-11 w-full rounded-lg bg-primary px-4 py-3 font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-60"
    >
      {awaitingConsent ? (
        'Localisation en cours…'
      ) : (
        <>
          <span aria-hidden="true">▶ </span>
          Démarrer la navigation
        </>
      )}
    </button>
  );
}
