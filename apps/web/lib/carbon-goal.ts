import type { CarbonGoal, CarbonSummaryDays } from '@urbanflow/shared';

import { formatCarbon } from './format-carbon';

/**
 * Objectif carbone de la page « Mon impact » (UF-805) — le bloc « 🎯 Objectif :
 * rester sous 16 kg » de la planche.
 *
 * Module **pur** : il traduit l'objectif proraté publié par l'API en une barre
 * de progression, un état et une phrase. Aucun prorata n'est refait ici — le
 * serveur l'a déjà fait, et deux arithmétiques pour un même objectif finiraient
 * par diverger (C5).
 *
 * Couvre : C7 (l'état est porté par un mot autant que par une couleur, la barre
 * est doublée d'un texte), C5 (aucun recalcul).
 */

/**
 * Où en est l'usager de son budget.
 *
 * Trois états et non deux : « atteint » n'est pas « dépassé ». Frôler son
 * objectif mérite un avertissement, pas le rouge d'un échec — et un écran qui
 * peindrait 92 % comme 128 % découragerait précisément celui qui est en train
 * de réussir.
 */
export type CarbonGoalState = 'on-track' | 'close' | 'exceeded';

/** L'objectif, prêt à peindre. */
export interface CarbonGoalView {
  /** Budget de la période, « 16 kg CO₂ ». */
  targetLabel: string;
  /** Émissions déjà consommées, « 13,5 kg CO₂ ». */
  emittedLabel: string;
  /** Part consommée, non bornée : « 128 % » sur un dépassement. */
  usedPercent: number;
  /**
   * Largeur de la barre, elle **bornée** à 100.
   *
   * Le chiffre et la barre disent volontairement deux choses différentes : une
   * barre qui déborderait de son cadre ne serait pas plus lisible, alors que le
   * pourcentage, lui, doit rester exact.
   */
  barPercent: number;
  state: CarbonGoalState;
  /** Verdict lisible : « en bonne voie », « objectif dépassé »… */
  statusLabel: string;
  /**
   * L'objectif dit en une phrase complète, pour les technologies d'assistance
   * et pour le texte sous la barre (C7 — WCAG 1.1.1).
   */
  description: string;
}

/**
 * Seuil de vigilance, en part du budget consommée.
 *
 * Quatre-vingt-cinq pour cent : c'est la valeur de la planche (« 85 % » sur un
 * objectif tenu), et le moment où prévenir a encore une utilité — à 99 %, il
 * est trop tard pour changer quoi que ce soit au mois en cours.
 */
const CLOSE_THRESHOLD_PERCENT = 85;

/** Libellé de la période, aligné sur le sélecteur de l'écran. */
function periodLabel(days: CarbonSummaryDays): string {
  return `${days} jours`;
}

/**
 * Traduit l'objectif publié par l'API en bloc affichable (UF-805).
 *
 * ## Pourquoi la phrase mentionne l'objectif mensuel hors des 30 jours
 *
 * L'usager fixe **un** budget mensuel ; l'API le proratise à la période
 * affichée. Sur 7 ou 90 jours, la cible affichée n'est donc pas le nombre qu'il
 * a saisi, et taire d'où elle vient ferait passer un prorata pour une erreur.
 * Sur 30 jours les deux coïncident : la précision serait alors du bruit, elle
 * est omise.
 *
 * @param goal Objectif proraté publié par `GET /api/carbon/summary`, ou `null`
 * @param days Période affichée — sert à nommer la fenêtre dans la phrase
 * @returns Le bloc prêt à peindre, ou `null` si aucun objectif n'est fixé :
 * l'écran propose alors d'en définir un plutôt que d'annoncer un dépassement
 */
export function describeCarbonGoal(
  goal: CarbonGoal | null,
  days: CarbonSummaryDays,
): CarbonGoalView | null {
  if (!goal) return null;

  const state: CarbonGoalState =
    goal.usedPercent > 100
      ? 'exceeded'
      : goal.usedPercent >= CLOSE_THRESHOLD_PERCENT
        ? 'close'
        : 'on-track';

  const statusLabel =
    state === 'exceeded'
      ? 'objectif dépassé'
      : state === 'close'
        ? 'objectif bientôt atteint'
        : 'en bonne voie';

  const targetLabel = formatCarbon(goal.periodGrams);
  const emittedLabel = formatCarbon(goal.emittedGrams);

  // Hors 30 jours, la cible affichée est un prorata : le dire évite qu'elle
  // passe pour une valeur fausse au regard de ce que l'usager a saisi.
  const prorated =
    days === 30
      ? ''
      : ` (objectif mensuel de ${formatCarbon(goal.monthlyGrams)} ramené à ${periodLabel(days)})`;

  return {
    targetLabel,
    emittedLabel,
    usedPercent: goal.usedPercent,
    barPercent: Math.min(100, Math.max(0, goal.usedPercent)),
    state,
    statusLabel,
    description:
      `${emittedLabel} sur un objectif de ${targetLabel} ` +
      `sur ${periodLabel(days)}${prorated} — ${statusLabel}.`,
  };
}
