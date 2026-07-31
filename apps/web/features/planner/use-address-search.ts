'use client';

import { useEffect, useState } from 'react';

import {
  GEOCODING_ERROR_MESSAGES,
  MIN_QUERY_LENGTH,
  searchAddresses,
  type GeocodedPlace,
} from '../../lib/geocoding';

/**
 * Délai d'inactivité avant d'interroger le géocodeur (recette 4 du ticket).
 *
 * 300 ms : c'est la pause naturelle entre deux mots d'une frappe courante. Plus
 * court, on rappelle le service à chaque lettre ; plus long, la liste paraît en
 * retard sur la saisie. Concrètement, « bellecour » coûte **1 requête** au lieu
 * de 9 (C5/C10) — visible dans l'onglet Réseau du navigateur.
 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * État de la recherche d'adresses.
 *
 * - `idle` — saisie trop courte ou vide : rien n'est demandé
 * - `searching` — une requête est en vol
 * - `results` — au moins une suggestion à afficher
 * - `empty` — le géocodeur a répondu, mais rien dans la métropole
 * - `error` — service injoignable ; la saisie libre reste possible
 */
export type AddressSearchStatus = 'idle' | 'searching' | 'results' | 'empty' | 'error';

export interface AddressSearchState {
  status: AddressSearchStatus;
  /** Suggestions prêtes à afficher (vide dans tous les autres états). */
  suggestions: GeocodedPlace[];
  /** Message d'échec à annoncer, ou `null`. */
  message: string | null;
}

/**
 * Autocomplétion d'adresses avec débounce et annulation (UF-203 — F2, C5/C10).
 *
 * **Une seule requête en vol à la fois** : chaque nouvelle frappe annule la
 * précédente via `AbortController`. Cela économise de la bande passante, mais
 * règle surtout un bug classique d'autocomplétion — la réponse d'une requête
 * ancienne qui arrive après une plus récente et réaffiche des suggestions
 * périmées. Ici, une réponse annulée ne peut plus toucher l'état.
 *
 * **Le hook ne détient pas le texte saisi** : il le reçoit. Le champ reste donc
 * maître de sa valeur (saisie libre, sélection, inversion départ/arrivée), et le
 * hook ne fait qu'observer.
 *
 * @param query Texte courant du champ
 * @param enabled `false` fige la recherche — utilisé juste après une sélection,
 *   pour que le libellé qu'on vient d'écrire dans le champ ne relance pas
 *   aussitôt une requête et ne rouvre pas la liste
 */
export function useAddressSearch(query: string, enabled: boolean): AddressSearchState {
  const [state, setState] = useState<AddressSearchState>({
    status: 'idle',
    suggestions: [],
    message: null,
  });

  useEffect(() => {
    const trimmed = query.trim();

    if (!enabled || trimmed.length < MIN_QUERY_LENGTH) {
      setState({ status: 'idle', suggestions: [], message: null });
      return;
    }

    const controller = new AbortController();
    // Le compte à rebours repart à chaque frappe : seule la dernière pause
    // de 300 ms déclenche réellement un appel.
    const timer = setTimeout(() => {
      setState((current) => ({ ...current, status: 'searching', message: null }));

      void searchAddresses(trimmed, controller.signal).then((result) => {
        if (controller.signal.aborted) return;

        if (!result.ok) {
          // Annulation : l'effet suivant a déjà pris la main, ne rien afficher.
          if (result.reason === 'aborted') return;
          setState({
            status: 'error',
            suggestions: [],
            message: GEOCODING_ERROR_MESSAGES[result.reason],
          });
          return;
        }

        setState({
          status: result.places.length > 0 ? 'results' : 'empty',
          suggestions: result.places,
          message: null,
        });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled]);

  return state;
}
