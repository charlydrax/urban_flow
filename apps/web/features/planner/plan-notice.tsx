'use client';

import type { ReactNode } from 'react';

import type { PlanNotice as PlanNoticeContent } from '../../lib/plan-feedback';

/** Habillage d'un message, choisi d'après ce qu'il demande à l'usager. */
export type PlanNoticeTone =
  /** Rien à faire, c'est une information (aucun trajet, redirection en cours). */
  | 'info'
  /** Les résultats sont utilisables mais incomplets (mode dégradé — C10). */
  | 'warning'
  /** La recherche n'a pas abouti. */
  | 'error';

/**
 * Fond teinté + texte de la charte (UF-007).
 *
 * Les trois couples sont vérifiés au seuil AA du **texte courant** (4.5:1) par
 * `design-tokens.test.ts` — pas au seuil des objets graphiques : ce sont des
 * phrases à lire, pas des pastilles.
 *
 * Le ton `warning` porte `text-warning` (5.73:1 sur Gold 100) et non le
 * `text-gold` du badge « récompense », qui n'atteint que 4.28:1 sur ce fond. Le
 * badge s'en accommode à 12 px gras ; un paragraphe de 14 px, non.
 */
const TONE_CLASSES: Record<PlanNoticeTone, string> = {
  info: 'bg-tint-neutral text-ink-700',
  warning: 'bg-tint-gold text-warning',
  error: 'bg-tint-red text-error',
};

/** Pictogramme d'appui, purement décoratif — le ton est déjà porté par le texte. */
const TONE_ICONS: Record<PlanNoticeTone, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '⚠️',
};

export interface PlanNoticeProps extends PlanNoticeContent {
  tone: PlanNoticeTone;
  /** Complément replié sous le message (détail des sources absentes, par ex.). */
  children?: ReactNode;
}

/**
 * Message d'état du planificateur (UF-405) — le seul endroit qui **peint** un
 * cas non nominal.
 *
 * ## Pourquoi le rôle ARIA vient d'ailleurs
 *
 * `role` n'est pas déduit du ton : c'est `lib/plan-feedback.ts` qui le décide,
 * avec le message, et qui est testé pour cela. Un composant qui poserait
 * `role="alert"` dès que le fond est rouge ferait couper la parole au lecteur
 * d'écran pour une session expirée, dont la redirection est déjà lancée. Le ton
 * dit **à quoi ça ressemble**, le rôle dit **si ça interrompt** (C7 — WCAG 4.1.3).
 *
 * ## Ce que le message ne contient jamais
 *
 * Ni statut HTTP, ni cause technique, ni nom de service : le détail reste dans
 * les logs du serveur (C11). Le texte affiché sort de `plan-feedback.ts`, où
 * cette règle est vérifiée par un test.
 *
 * L'icône est en `aria-hidden` et doublée par le texte : « ⚠️ » énoncé seul ne
 * dit rien d'exploitable (C7 — WCAG 1.1.1).
 */
export function PlanNotice({ tone, role, message, children }: PlanNoticeProps) {
  return (
    <div role={role} className={`flex gap-2 rounded-md px-3 py-2 text-sm ${TONE_CLASSES[tone]}`}>
      <span aria-hidden="true">{TONE_ICONS[tone]}</span>
      <div className="flex flex-col gap-1">
        <p>{message}</p>
        {children}
      </div>
    </div>
  );
}
