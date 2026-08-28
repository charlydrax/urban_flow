import type { Itinerary } from '@urbanflow/shared';

import { formatCarbon } from './format-carbon';

/**
 * Badge CO₂ des cartes de résultat (UF-504) — de l'empreinte publiée par le
 * serveur à la pastille peinte sur la carte.
 *
 * Module **pur**, sans React, comme `itinerary-cards.ts` et `carbon-breakdown.ts`
 * avant lui : il ne fait que traduire des grammes en libellé, en niveau et en
 * classes utilitaires. C'est ce qui le rend testable dans l'environnement `node`
 * de Vitest, où les tests de composants (jsdom) n'existent pas.
 *
 * ## Ce qu'il ne calcule pas
 *
 * **Aucun gramme.** Le total et la référence voiture viennent tous deux de
 * `itinerary.carbon`, que le Service Carbone a produit (UF-501). Le seul chiffre
 * fabriqué ici est un **pourcentage d'affichage**, qui ne sort jamais de l'écran.
 *
 * Couvre : C7 (le code couleur est doublé d'un libellé écrit et d'un
 * pourcentage lisibles, WCAG 1.4.1), C5 (aucun recalcul côté client), C9
 * (l'unité publiée est respectée), C2 (une pastille compacte reste lisible sur
 * un écran étroit).
 */

/**
 * Niveau d'empreinte d'un itinéraire, **relatif à la voiture solo**.
 *
 * Le niveau n'est pas lu sur une échelle de grammes absolue : 300 g pour
 * traverser la métropole est excellent, 300 g pour aller au bout de la rue est
 * catastrophique. Un seuil en grammes classerait donc les trajets par
 * **longueur** bien plus que par vertu, et un long trajet en métro finirait
 * peint en rouge. Le rapport à la référence voiture — la même distance, seul à
 * bord — neutralise la distance et ne compare plus que les modes.
 */
export type CarbonGrade = 'low' | 'moderate' | 'high';

/**
 * Bornes du code couleur, en **part de la référence voiture**.
 *
 * Elles sont posées là où le barème (`emission-factors.ts`, côté API) sépare
 * réellement les familles de modes, et non à des dixièmes ronds choisis à vue :
 *
 * | Mode dominant             | Part de la voiture | Niveau     |
 * | ------------------------- | ------------------ | ---------- |
 * | Marche, vélo, tram, métro | 0 – 2 %            | `low`      |
 * | Trottinette               | ~11 %              | `low`      |
 * | Covoiturage               | ~40 %              | `moderate` |
 * | Bus thermique             | ~44 %              | `moderate` |
 * | (au-delà)                 | > 50 %             | `high`     |
 *
 * `low` à 20 % laisse la trottinette du bon côté sans y faire entrer le bus ;
 * `moderate` à 50 % dit « vous avez au moins divisé par deux ». Aucun mode du
 * planificateur n'atteint aujourd'hui `high` à lui seul — le niveau existe pour
 * les itinéraires **mixtes** à dominante motorisée, et pour ne pas mentir si le
 * barème ou le catalogue de modes évoluent.
 */
export const CARBON_GRADE_THRESHOLDS = { low: 0.2, moderate: 0.5 } as const;

/** Ce que chaque niveau vaut à l'écran — libellé, pictogramme et teinte de la charte. */
interface GradeStyle {
  /** Libellé écrit du niveau — c'est lui qui porte l'information, pas la couleur (C7). */
  label: string;
  /** Pictogramme décoratif, toujours posé en `aria-hidden` (C7 — WCAG 1.1.1). */
  icon: string;
  /**
   * Couple fond/texte du niveau, repris du bloc « Badges — états & modes » de la
   * charte (UF-007) : `tint-green`/`primary-dark` (« ✓ Acquis »),
   * `tint-gold`/`warning` (« ★ Récompense ») et `tint-red`/`error`
   * (« ⚠ Perturbation »). Les trois couples sont vérifiés au seuil AA du texte
   * courant par `design-tokens.test.ts` — c'est ce test qui avait écarté
   * `text-gold` (4,28:1 sur Gold 100) au profit de `text-warning`.
   */
  className: string;
}

const GRADE_STYLES: Record<CarbonGrade, GradeStyle> = {
  low: {
    label: 'Très faible empreinte',
    icon: '🌱',
    className: 'bg-tint-green text-primary-dark',
  },
  moderate: {
    label: 'Empreinte modérée',
    icon: '🍂',
    className: 'bg-tint-gold text-warning',
  },
  high: {
    label: 'Empreinte élevée',
    icon: '🔥',
    className: 'bg-tint-red text-error',
  },
};

/**
 * Repli quand l'itinéraire ne porte pas de détail carbone : la valeur est
 * affichée, le niveau **n'est pas inventé**.
 *
 * Sans référence voiture, il n'y a rien à quoi comparer les grammes — et
 * peindre la pastille en vert « par défaut », comme le faisait UF-404,
 * reviendrait à décerner un satisfecit à un trajet dont on ne sait rien (C10).
 * Le gris est celui du badge « Neutre » de la charte.
 */
const UNGRADED_STYLE: GradeStyle = {
  label: 'Empreinte',
  icon: '🌍',
  className: 'bg-tint-neutral text-ink-700',
};

/** Le badge CO₂ d'une carte de résultat, prêt à peindre. */
export interface CarbonBadge {
  /** Empreinte dans l'unité publiée, « 240 g CO₂ » ou « 1,2 kg CO₂ ». */
  valueLabel: string;
  /** Niveau relatif à la voiture, ou `null` si l'itinéraire ne porte pas de détail carbone. */
  grade: CarbonGrade | null;
  /** Libellé écrit du niveau, « Très faible empreinte ». */
  gradeLabel: string;
  /** Pictogramme du niveau, décoratif. */
  icon: string;
  /** Classes utilitaires du couple fond/texte. */
  className: string;
  /**
   * Économie réalisée face à la voiture solo, « −89 % vs voiture », ou `null`
   * quand la référence est nulle, absente, ou que rien n'est économisé.
   *
   * C'est le **repère** que demande le ticket : « 240 g » ne dit rien à
   * personne dans l'absolu, « 89 % de moins qu'en voiture » se comprend sans
   * connaître le barème. Il double aussi le code couleur en clair, pour qui ne
   * distingue pas le vert du gold (C7 — WCAG 1.4.1).
   */
  comparisonLabel: string | null;
  /**
   * Le badge dit en une phrase, reprise par l'`aria-label` de la carte.
   *
   * « 🌱 240 g CO₂ −89 % » énoncé tel quel donne une suite de fragments ; cette
   * phrase nomme le niveau et ce à quoi il se compare.
   */
  description: string;
}

/**
 * Traduit l'empreinte d'un itinéraire en badge affichable (UF-504).
 *
 * @param itinerary Itinéraire affiché dans le panneau de résultats
 * @returns Le badge, toujours — un itinéraire a toujours une empreinte à
 * montrer, même quand son détail (donc son niveau) manque
 */
export function carbonBadge(itinerary: Itinerary): CarbonBadge {
  const valueLabel = formatCarbon(itinerary.carbonGrams);
  const grade = carbonGrade(itinerary);
  const style = grade ? GRADE_STYLES[grade] : UNGRADED_STYLE;
  const comparisonLabel = compareToCar(itinerary);

  // Sans niveau établi, la phrase est la valeur **seule** : « Empreinte, 240 g
  // CO₂ » ferait passer le repli pour une qualification, alors qu'il est
  // précisément l'aveu qu'on ne sait pas qualifier.
  const parts = grade ? [`${style.label}, ${valueLabel}`] : [valueLabel];
  if (comparisonLabel) parts.push(comparisonLabel);

  return {
    valueLabel,
    grade,
    gradeLabel: style.label,
    icon: style.icon,
    className: style.className,
    comparisonLabel,
    description: parts.join(', '),
  };
}

/**
 * Niveau d'empreinte d'un itinéraire, ou `null` s'il est indéterminable.
 *
 * @param itinerary Itinéraire à classer
 * @returns `null` dès que la référence voiture manque ou est nulle : un
 * itinéraire sans détail carbone (cache antérieur à UF-501) et un itinéraire de
 * distance nulle n'ont pas de dénominateur, et un rapport sans dénominateur ne
 * se peint pas — il s'omet
 */
export function carbonGrade(itinerary: Itinerary): CarbonGrade | null {
  const footprint = itinerary.carbon;
  if (!footprint || footprint.carEquivalentGrams <= 0) return null;

  const share = footprint.totalGrams / footprint.carEquivalentGrams;
  if (share <= CARBON_GRADE_THRESHOLDS.low) return 'low';
  if (share <= CARBON_GRADE_THRESHOLDS.moderate) return 'moderate';
  return 'high';
}

/**
 * Économie face à la voiture solo, en pourcentage entier : « −89 % vs voiture ».
 *
 * Le pourcentage est lu sur `avoidedGrams`, que le serveur publie, plutôt que
 * refait depuis le total : `avoidedGrams` est déjà borné à zéro côté API pour
 * ne jamais annoncer une économie négative, et refaire la soustraction ici
 * rouvrirait le cas que le serveur a fermé.
 */
function compareToCar(itinerary: Itinerary): string | null {
  const footprint = itinerary.carbon;
  if (!footprint || footprint.carEquivalentGrams <= 0) return null;

  const percent = Math.round((footprint.avoidedGrams / footprint.carEquivalentGrams) * 100);

  // Un itinéraire qui n'économise rien face à la voiture n'a pas de « −0 % » à
  // afficher : la mention disparaît, et la teinte rouge dit déjà la chose.
  if (percent <= 0) return null;

  return `−${percent} % vs voiture`;
}
