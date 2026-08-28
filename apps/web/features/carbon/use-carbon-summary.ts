'use client';

import {
  DEFAULT_CARBON_SUMMARY_DAYS,
  type CarbonSummary,
  type CarbonSummaryDays,
} from '@urbanflow/shared';
import { useEffect, useState } from 'react';

import { apiClient } from '../../lib/api-client';

/**
 * État du suivi carbone personnel.
 *
 * - `loading` — lecture en cours (première ouverture ou changement de période)
 * - `ready` — bilan à jour, éventuellement vide pour un compte neuf
 * - `error` — l'API n'a pas répondu ; l'écran le dit au lieu d'afficher des zéros
 */
export type CarbonSummaryStatus = 'loading' | 'ready' | 'error';

export interface CarbonSummaryState {
  status: CarbonSummaryStatus;
  /** Bilan de la période demandée, `null` tant qu'aucun n'est arrivé. */
  summary: CarbonSummary | null;
  /** Période actuellement affichée, en jours. */
  days: CarbonSummaryDays;
  /** Change la période — déclenche une nouvelle lecture. */
  setDays: (days: CarbonSummaryDays) => void;
}

/**
 * Suivi carbone personnel du compte connecté (UF-505).
 *
 * ## Une lecture par période, et rien d'autre
 *
 * Le bilan est chargé à l'ouverture puis à chaque changement de période, jamais
 * rafraîchi tout seul : c'est un cumul d'historique, il ne bouge pas pendant
 * qu'on le regarde. Aucun `setInterval`, aucun rechargement au focus (C5, C10).
 *
 * Chaque période est demandée **au serveur** plutôt que dérivée d'un jeu de
 * données plus large téléchargé une fois : agréger 90 jours pour n'en afficher
 * que 7 ferait payer au réseau mobile de l'usager ce que la base fait mieux et
 * pour rien.
 *
 * ## Un zéro n'est pas une panne
 *
 * En cas d'échec réseau, l'état passe à `error` et le composant le dit. Afficher
 * « 0 g CO₂ » pour une requête qui n'a pas abouti serait pire qu'un message
 * d'erreur : l'usager y lirait un bilan, et un faux.
 *
 * ## Réponse périmée
 *
 * Un compteur de requête écarte les réponses hors d'ordre : basculer vite de
 * « 30 jours » à « 7 jours » ne doit pas laisser la réponse la plus lente
 * écraser la plus récente et afficher des totaux qui ne correspondent plus au
 * bouton actif.
 *
 * Le 401 « session morte » reste l'affaire de `SessionProvider`, prévenu par
 * l'intercepteur du client API — ce hook ne connaît pas le routeur.
 *
 * @param initialDays Période à afficher à l'ouverture
 */
export function useCarbonSummary(
  initialDays: CarbonSummaryDays = DEFAULT_CARBON_SUMMARY_DAYS,
): CarbonSummaryState {
  const [days, setDays] = useState<CarbonSummaryDays>(initialDays);
  const [summary, setSummary] = useState<CarbonSummary | null>(null);
  const [status, setStatus] = useState<CarbonSummaryStatus>('loading');

  useEffect(() => {
    // `AbortController` sert ici de jeton d'annulation logique : la requête part
    // sans lui (le client API ne l'expose pas), mais son signal dit à l'effet
    // démonté — ou relancé sur une autre période — de ne plus rien écrire.
    const controller = new AbortController();
    setStatus('loading');

    void apiClient
      .getCarbonSummary(days)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setSummary(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Le bilan précédent reste en mémoire mais n'est plus affiché : il
        // décrivait une autre période, le montrer sous le nouveau bouton
        // mentirait sur ce qu'il représente.
        setStatus('error');
      });

    return () => controller.abort();
  }, [days]);

  return { status, summary, days, setDays };
}
