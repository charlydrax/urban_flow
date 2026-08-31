import type { CarbonModeTotals } from '@urbanflow/shared';

import { formatCarbon } from './format-carbon';
import { formatDistance } from './format-distance';
import { MODE_ICONS } from './itinerary-cards';
import { MODE_TRACK_STYLES } from './route-map-layers';

/**
 * Répartition des émissions par mode (UF-805) — le bloc « Émissions par mode »
 * de la planche mobile, « Répartition des émissions » sur la version desktop.
 *
 * Module **pur**, sans React, comme `carbon-breakdown.ts` dont il est le
 * pendant : celui-là détaille UN itinéraire segment par segment, celui-ci
 * cumule UNE période mode par mode. Les deux traduisent des grammes en largeurs
 * de barre et en phrases françaises, et se testent dans l'environnement `node`
 * de Vitest.
 *
 * ## Ce qu'il ne calcule pas
 *
 * Aucun gramme, aucun cumul : l'API publie déjà les totaux par mode, agrégés
 * par la base à partir de `trip_mode_footprints`. Les seuls chiffres produits
 * ici sont des **pourcentages d'affichage**, qui ne sortent jamais de l'écran
 * (C5 — rien n'est recalculé côté client).
 *
 * Couvre : C7 (chaque barre est doublée d'un texte, l'ensemble est énonçable en
 * une phrase), C5 (aucun recalcul), C9 (les unités publiées sont respectées).
 */

/** Une ligne de la répartition : ce qu'un mode a coûté sur la période. */
export interface CarbonModeRow {
  /** Identité stable dans la liste — le mode ne peut y figurer qu'une fois. */
  key: string;
  /** Pictogramme décoratif, à poser en `aria-hidden` (C7 — WCAG 1.1.1). */
  icon: string;
  /** Libellé écrit du mode : « Bus », « Métro »… */
  label: string;
  /** Couleur du mode — la même que son tracé sur la carte et ses badges. */
  color: string;
  /** Empreinte du mode sur la période, « 5,9 kg CO₂ ». */
  carbonLabel: string;
  /** Distance cumulée sur ce mode, « 42,8 km ». */
  distanceLabel: string;
  /** Nombre de trajets concernés, « 7 trajets ». */
  tripsLabel: string;
  /**
   * Part du mode dans le total émis, en pourcentage entier — largeur de la
   * barre **et** valeur affichée en bout de ligne sur la version desktop.
   */
  sharePercent: number;
}

/** La répartition, prête à peindre. */
export interface CarbonModeSummary {
  rows: CarbonModeRow[];
  /** Total émis sur la période, « 13,5 kg CO₂ » — le dénominateur des parts. */
  totalLabel: string;
  /**
   * Le bloc dit en une phrase, pour les technologies d'assistance.
   *
   * Une pile de barres colorées annoncée cellule par cellule donne « Bus, 44,
   * 5,9 » — une suite de nombres sans verbe. Cette phrase est ce qu'un lecteur
   * d'écran annonce à la place (C7 — WCAG 1.1.1).
   */
  description: string;
}

/** Pourcentage entier de `part` dans `whole`, borné à [0, 100]. */
function share(part: number, whole: number): number {
  if (!Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
}

/**
 * Traduit la répartition par mode publiée par l'API en lignes affichables
 * (UF-805).
 *
 * ## Un mode à zéro gramme n'est pas un mode absent
 *
 * La marche et le vélo pèsent zéro ou presque au barème ADEME, mais l'usager
 * les a bel et bien empruntés — les masquer donnerait un écran où « je fais
 * tout à pied » se lit « je n'ai rien fait ». Leur ligne est donc conservée,
 * avec une barre nulle et sa distance : c'est la distance qui porte alors
 * l'information. Seuls les modes qu'aucun trajet n'a empruntés sont absents, et
 * ils le sont déjà en sortie de base.
 *
 * @param modeBreakdown Cumuls par mode publiés par `GET /api/carbon/summary`
 * @param emittedGrams Total émis de la période — le dénominateur des parts
 * @returns La répartition prête à peindre, ou `null` si la période n'a aucun
 * trajet : l'écran affiche alors son invite « votre bilan est encore vide »
 * plutôt qu'un cadre sans barre
 */
export function describeCarbonModes(
  modeBreakdown: CarbonModeTotals[],
  emittedGrams: number,
): CarbonModeSummary | null {
  if (modeBreakdown.length === 0) return null;

  const rows: CarbonModeRow[] = modeBreakdown.map((total) => {
    const style = MODE_TRACK_STYLES[total.mode];

    return {
      key: `carbon-mode:${total.mode}`,
      icon: MODE_ICONS[total.mode],
      label: style.label,
      color: style.color,
      carbonLabel: formatCarbon(total.grams),
      distanceLabel: formatDistance(total.distanceMeters),
      tripsLabel: `${total.tripsCount} trajet${total.tripsCount > 1 ? 's' : ''}`,
      sharePercent: share(total.grams, emittedGrams),
    };
  });

  const spoken = rows.map(
    (row) => `${row.label}, ${row.carbonLabel} sur ${row.distanceLabel}, ${row.sharePercent} %`,
  );

  return {
    rows,
    totalLabel: formatCarbon(emittedGrams),
    description: `Répartition de vos ${formatCarbon(emittedGrams)} par mode : ${spoken.join(' ; ')}.`,
  };
}
