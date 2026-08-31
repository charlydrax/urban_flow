'use client';

import type { Place, SharedMobilityStation, TransportSourceStatus } from '@urbanflow/shared';
import { useEffect, useState } from 'react';

import { apiClient } from '../../lib/api-client';

/**
 * Rayon de recherche des bornes affichées sous les résultats, en mètres.
 *
 * Le défaut du connecteur (500 m, « ce qu'on fait à pied »), et non le rayon
 * élargi de la planification (900 m) : la carte propose une borne à l'usager,
 * pas un rabattement à l'algorithme. Une station à un quart d'heure de marche
 * n'est pas une option qu'on met en avant.
 */
const CARD_STATION_RADIUS_METERS = 500;

/**
 * Nombre de bornes demandées.
 *
 * La carte n'en montre **qu'une** — la plus proche qui loue. On en demande
 * trois pour que la première borne vide ou fermée ne fasse pas disparaître
 * l'encart, sans transporter dix stations pour en peindre une (C5).
 */
const CARD_STATION_LIMIT = 3;

export interface RealtimeContextState {
  stations: SharedMobilityStation[];
  statuses: TransportSourceStatus[];
  /** `true` pendant le chargement — l'écran réserve alors la place des cartes. */
  loading: boolean;
}

/**
 * Contexte temps réel des deux cartes de l'écran de résultats (UF-804) :
 * bornes en libre-service autour du départ, et état des sources F3.
 *
 * ## Deux appels, une fois par recherche
 *
 * Le hook ne se déclenche que sur changement du point d'origine, c'est-à-dire
 * **une fois par recherche** — pas à chaque rendu, pas sur un intervalle. Il
 * n'y a pas de `setInterval` ici, et c'est délibéré : rafraîchir un nombre de
 * vélos toutes les trente secondes coûterait des requêtes en continu à
 * quelqu'un qui lit une liste (C5 — « pas de polling inutile »), pour une
 * information qui ne change pas assez vite pour le justifier. Le suivi
 * réellement continu est le sujet d'UF-806.
 *
 * Les deux appels partent **en parallèle** : ils ne dépendent pas l'un de
 * l'autre, et les enchaîner doublerait l'attente pour rien (C10).
 *
 * ## Une panne ici ne casse rien
 *
 * Un échec — réseau, 401, source muette — laisse les listes vides, et les
 * cartes ne sont simplement pas rendues. C'est la dégradation gracieuse
 * appliquée à un complément d'information : les itinéraires, eux, sont déjà à
 * l'écran, et une bannière rouge sous eux ferait croire à un échec de la
 * recherche (C10).
 *
 * ## Concurrence
 *
 * Un compteur écarte la réponse d'une recherche périmée, comme dans
 * `use-route-plan` : sans lui, la station du trajet précédent s'afficherait
 * sous les résultats du suivant.
 *
 * @param origin Point de départ de la recherche en cours, `null` avant la première
 * @returns Les données des deux cartes, et l'état de chargement
 */
export function useRealtimeContext(origin: Place | null): RealtimeContextState {
  const [state, setState] = useState<RealtimeContextState>({
    stations: [],
    statuses: [],
    loading: false,
  });

  const lat = origin?.lat;
  const lng = origin?.lng;

  useEffect(() => {
    if (lat === undefined || lng === undefined) {
      setState({ stations: [], statuses: [], loading: false });
      return;
    }

    let current = true;
    setState((previous) => ({ ...previous, loading: true }));

    void Promise.all([
      apiClient.getNearbyStations(lat, lng, {
        radius: CARD_STATION_RADIUS_METERS,
        limit: CARD_STATION_LIMIT,
      }),
      apiClient.getTransportStatus(),
    ])
      .then(([nearby, statuses]) => {
        if (!current) return;
        setState({ stations: nearby.stations, statuses, loading: false });
      })
      .catch(() => {
        // Volontairement muet : ces cartes sont un complément. Les itinéraires
        // sont déjà affichés, et signaler ici une panne ferait douter d'un
        // résultat qui, lui, est arrivé (C10).
        if (!current) return;
        setState({ stations: [], statuses: [], loading: false });
      });

    return () => {
      current = false;
    };
  }, [lat, lng]);

  return state;
}
