'use client';

import { OFFLINE_BANNER } from '../../lib/offline';
import { useOnlineStatus } from './use-online-status';

/**
 * Indicateur global « mode hors-ligne » (UF-601 — recette 3).
 *
 * Bandeau discret posé sous l'en-tête, sur toutes les pages : la connexion peut
 * tomber n'importe où, pas seulement sur le planificateur, et un indicateur
 * qu'il faut aller chercher n'en est pas un.
 *
 * ## Pourquoi la région vit même en ligne
 *
 * Le `<div role="status">` est **toujours monté**, vide quand tout va bien.
 * Une région live insérée au moment de la coupure n'est pas annoncée : les
 * lecteurs d'écran ne surveillent que les régions déjà présentes dans l'arbre
 * au moment du changement (C7 — WCAG 4.1.3). Monté d'avance, il annonce la
 * perte de connexion **et** son retour, sans interrompre la lecture en cours —
 * `status`, pas `alert` : perdre le réseau n'est pas une urgence, et
 * l'application reste utilisable.
 *
 * ## Habillage
 *
 * `text-warning` sur `bg-tint-gold` : le seul couple « avertissement » de la
 * charte vérifié au seuil AA du texte courant (5.73:1) par
 * `lib/design-tokens.test.ts`. L'icône est décorative et doublée par
 * l'étiquette : « ⚠️ » énoncé seul ne dit rien (C7 — WCAG 1.1.1).
 *
 * Le texte affiché vient de `lib/offline.ts` — le composant peint, il ne
 * rédige pas.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();

  return (
    <div role="status" aria-live="polite">
      {!online && (
        <div className="border-b border-ink-200 bg-tint-gold">
          <p className="mx-auto flex max-w-5xl items-start gap-2 px-4 py-2 text-sm text-warning">
            <span aria-hidden="true">⚠️</span>
            <span>
              <strong className="font-bold">{OFFLINE_BANNER.label}</strong>
              {' — '}
              {OFFLINE_BANNER.message}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
