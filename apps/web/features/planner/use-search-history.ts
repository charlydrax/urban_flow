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
  /**
   * Fait remonter en tête un trajet **déjà écrit par l'API** (UF-403).
   *
   * @param id Ligne créée, telle que renvoyée dans `searchHistoryId` par `POST /routes/plan`
   * @param from Départ de la recherche
   * @param to Arrivée de la recherche
   */
  noteRecorded: (id: string, from: SearchHistoryPlace, to: SearchHistoryPlace) => void;
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
 * **localement**. Aucune requête périodique, aucun rechargement après écriture
 * (C5, C10).
 *
 * ## Qui écrit dans l'historique
 *
 * Plus ce hook, depuis UF-403 : c'est `POST /routes/plan` qui enregistre la
 * recherche (étape 18 du flux) et rend la ligne créée dans `searchHistoryId`.
 * Le hook se contente d'en prendre acte via `noteRecorded`, sans appel réseau.
 *
 * Le motif précédent — un `POST /search-history` émis par le formulaire — aurait
 * fait **deux** lignes pour un seul trajet. L'endpoint est retiré du contrat par
 * UF-807 : un point d'écriture sans appelant n'est pas une réserve, c'est une
 * porte qu'on oublie de surveiller.
 *
 * ## L'historique ne doit jamais casser une recherche
 *
 * Un `searchHistoryId` à `null` (écriture échouée côté serveur) n'est pas
 * traité comme une erreur : la liste n'est pas mise à jour, et c'est tout. Ne
 * pas mémoriser un trajet est un désagrément ; le signaler comme une panne de la
 * recherche serait une régression (dégradation gracieuse — C10).
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

  const noteRecorded = useCallback(
    (id: string, from: SearchHistoryPlace, to: SearchHistoryPlace) => {
      if (!enabled) return;

      // Entrée reconstituée localement, **sans requête** : l'API vient de
      // l'écrire et nous en a rendu l'identifiant, nous connaissons les deux
      // extrémités. Relire la collection pour retrouver ce qu'on sait déjà
      // coûterait un aller-retour à chaque recherche (C5).
      //
      // `selectedSummary`, `carbonGrams` et `carEquivalentGrams` restent nuls
      // tant qu'aucune option n'a été retenue — c'est exactement ce que contient
      // la ligne en base à cet instant, et la liste n'affiche de toute façon que
      // le trajet. Le choix arrive plus tard, par `PATCH .../selection`
      // (UF-505), et cette liste n'a pas besoin d'en prendre acte : elle sert de
      // rappels de trajets, pas de bilan.
      const created: SearchHistoryEntry = {
        id,
        from,
        to,
        selectedSummary: null,
        carbonGrams: null,
        carEquivalentGrams: null,
        createdAt: new Date().toISOString(),
        // Le trajet vient d'être cherché, il n'a évidemment pas encore été
        // parcouru (UF-807) : l'arrivée du guidage est le seul événement qui
        // renseigne ce champ, et cette liste ne sert de toute façon que de
        // rappels de trajets.
        completedAt: null,
      };

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
    },
    [enabled],
  );

  return { status, entries, noteRecorded };
}
