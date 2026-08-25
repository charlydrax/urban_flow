'use client';

import {
  DEFAULT_SEARCH_HISTORY_LIMIT,
  type SearchHistoryEntry,
  type SearchHistoryPlace,
} from '@urbanflow/shared';
import { useCallback, useEffect, useState } from 'react';

import { apiClient } from '../../lib/api-client';

/**
 * État de la liste des trajets récents.
 *
 * - `disabled` — personne n'est connecté : il n'y a pas d'historique à avoir
 * - `loading` — première lecture en cours
 * - `ready` — liste à jour (éventuellement vide, pour un compte neuf)
 * - `error` — l'API n'a pas répondu ; l'écran continue de fonctionner sans
 */
export type SearchHistoryStatus = 'disabled' | 'loading' | 'ready' | 'error';

export interface SearchHistoryState {
  status: SearchHistoryStatus;
  /** Trajets récents, du plus récent au plus ancien. */
  entries: SearchHistoryEntry[];
  /** Enregistre une recherche et remonte la liste sans la relire (C5). */
  remember: (from: SearchHistoryPlace, to: SearchHistoryPlace) => void;
}

/** Deux entrées désignent le même trajet quand les deux libellés coïncident. */
function isSameTrip(a: SearchHistoryEntry, b: SearchHistoryEntry): boolean {
  return a.from.label === b.from.label && a.to.label === b.to.label;
}

/**
 * Trajets récents du compte connecté (UF-204 — F2).
 *
 * ## Une seule lecture, puis plus rien
 *
 * La liste est chargée une fois, à l'ouverture de l'écran, et ensuite entretenue
 * **localement** : `POST /search-history` renvoie l'entrée créée, qu'on place en
 * tête sans relire toute la collection. Aucune requête périodique, aucun
 * rechargement après écriture (C5, C10).
 *
 * ## L'historique ne doit jamais casser une recherche
 *
 * `remember` n'est pas attendu par le formulaire : l'enregistrement part en
 * arrière-plan et un échec reste silencieux. Ne pas mémoriser un trajet est un
 * désagrément ; bloquer le calcul d'itinéraire pour cette raison serait une
 * régression fonctionnelle (dégradation gracieuse — C10).
 *
 * ## Sans session, rien
 *
 * Le middleware (UF-106) n'autorise l'accès au planificateur qu'avec une
 * session, mais il n'agit qu'à la **navigation** : une session peut mourir alors
 * que l'écran est déjà ouvert. `enabled` suit donc l'état réel de
 * `SessionProvider` — dès qu'il retombe, la liste est vidée de la mémoire du
 * navigateur et plus aucun appel n'est émis (pas de 401 en rafale, et pas de
 * trajets d'un compte laissés à l'écran après sa fermeture — C8).
 *
 * @param enabled `true` seulement lorsqu'une session est ouverte
 */
export function useSearchHistory(enabled: boolean): SearchHistoryState {
  const [entries, setEntries] = useState<SearchHistoryEntry[]>([]);
  const [status, setStatus] = useState<SearchHistoryStatus>('disabled');

  useEffect(() => {
    if (!enabled) {
      // Déconnexion en cours d'usage : les trajets quittent aussi la mémoire du
      // navigateur, ils ne doivent pas rester à l'écran après la session (C8).
      setEntries([]);
      setStatus('disabled');
      return;
    }

    const controller = new AbortController();
    setStatus('loading');

    void apiClient
      .getSearchHistory(DEFAULT_SEARCH_HISTORY_LIMIT)
      .then(({ entries: loaded }) => {
        if (controller.signal.aborted) return;
        setEntries(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Un 401 est déjà traité globalement par `SessionProvider` ; ici on se
        // contente de ne rien afficher plutôt que d'alerter sur un accessoire.
        setStatus('error');
      });

    return () => controller.abort();
  }, [enabled]);

  const remember = useCallback(
    (from: SearchHistoryPlace, to: SearchHistoryPlace) => {
      if (!enabled) return;

      void apiClient
        .createSearchHistory({ from, to })
        .then((created) => {
          // Le trajet remonte en tête ; sa précédente occurrence disparaît, sinon
          // relancer une recherche fréquente saturerait la liste de doublons —
          // même repli que celui appliqué côté API à la lecture.
          setEntries((current) =>
            [created, ...current.filter((entry) => !isSameTrip(entry, created))].slice(
              0,
              DEFAULT_SEARCH_HISTORY_LIMIT,
            ),
          );
          setStatus('ready');
        })
        .catch(() => undefined);
    },
    [enabled],
  );

  return { status, entries, remember };
}
