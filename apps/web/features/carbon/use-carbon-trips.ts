'use client';

import type { CarbonSummaryDays, CarbonTripsPage } from '@urbanflow/shared';
import { useEffect, useState } from 'react';

import { apiClient } from '../../lib/api-client';

/**
 * État du tableau « Détail par trajet » (UF-805).
 *
 * - `idle` — le tableau est replié, aucune requête n'est partie
 * - `loading` — lecture en cours
 * - `ready` — trajets à jour pour la période affichée
 * - `error` — l'API n'a pas répondu ; le tableau le dit au lieu de rester vide
 */
export type CarbonTripsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CarbonTripsState {
  status: CarbonTripsStatus;
  /** Trajets de la période, `null` tant qu'aucune lecture n'a abouti. */
  page: CarbonTripsPage | null;
}

/**
 * Trajets valorisés de la période affichée (UF-805).
 *
 * ## Chargé à la demande, et pas avant
 *
 * Le résumé tient en quelques centaines d'octets ; la liste des trajets peut
 * peser cent fois plus. La charger d'office ferait payer à chaque ouverture de
 * la page un contenu que l'usager ne déplie pas toujours — d'où le paramètre
 * `enabled`, piloté par l'état d'ouverture du tableau (C5/C10). Une fois
 * ouvert, un changement de période relance bien la lecture : le tableau et le
 * bandeau vert doivent décrire la même fenêtre.
 *
 * ## Réponse périmée
 *
 * Même garde que `useCarbonSummary` : un `AbortController` sert de jeton
 * d'annulation logique, pour qu'une réponse lente sur « 90 jours » n'écrase pas
 * une réponse rapide sur « 7 jours » et n'affiche pas des trajets qui ne
 * correspondent plus au bouton actif.
 *
 * Le 401 « session morte » reste l'affaire de `SessionProvider`, prévenu par
 * l'intercepteur du client API.
 *
 * @param days Période affichée, en jours
 * @param enabled `false` tant que le tableau est replié — rien n'est demandé
 */
export function useCarbonTrips(days: CarbonSummaryDays, enabled: boolean): CarbonTripsState {
  const [page, setPage] = useState<CarbonTripsPage | null>(null);
  const [status, setStatus] = useState<CarbonTripsStatus>('idle');

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    setStatus('loading');

    void apiClient
      .getCarbonTrips(days)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setPage(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // La liste précédente reste en mémoire mais n'est plus affichée : elle
        // décrivait une autre période, la montrer sous le nouveau bouton
        // mentirait sur ce qu'elle représente.
        setStatus('error');
      });

    return () => controller.abort();
  }, [days, enabled]);

  return { status, page };
}
