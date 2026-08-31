import type { CarbonFootprint, Itinerary, TransportMode } from '@urbanflow/shared';

import { formatCarbon } from './format-carbon';
import { formatDistance } from './format-distance';
import { MODE_ICONS } from './itinerary-cards';
import { MODE_TRACK_STYLES } from './route-map-layers';

/**
 * Lecture du détail carbone d'un itinéraire (UF-501) — de l'objet publié par le
 * Service Carbone aux lignes affichées sous la carte de résultat.
 *
 * Module **pur**, sans React : il ne fait que traduire des grammes en phrases
 * françaises et en largeurs de barre. C'est ce qui le rend testable dans
 * l'environnement `node` de Vitest, comme `itinerary-cards.ts` et
 * `route-map-layers.ts` avant lui.
 *
 * ## Ce qu'il ne calcule pas
 *
 * **Aucun gramme.** Les valeurs viennent toutes de `itinerary.carbon`, que le
 * serveur a calculé (étapes 16-17 du flux). Recalculer côté client une
 * empreinte que l'API vient de publier garantirait qu'un jour les deux
 * divergeront — et ferait porter au navigateur un travail déjà payé (C5). Les
 * seuls chiffres produits ici sont des **pourcentages d'affichage**, qui ne
 * sortent jamais de l'écran.
 *
 * Couvre : C7 (le tableau est doublé d'une phrase énonçable, les barres sont en
 * `aria-hidden`), C5 (aucun recalcul), C9 (les unités publiées sont respectées).
 */

/** Une ligne du détail : ce qu'un segment a coûté, et pourquoi. */
export interface CarbonBreakdownRow {
  /** Identité stable dans la liste — l'ordre des segments ne bouge pas. */
  key: string;
  mode: TransportMode;
  /** Pictogramme décoratif, à poser en `aria-hidden` (C7 — WCAG 1.1.1). */
  icon: string;
  /** Libellé écrit du mode, ligne comprise quand la source la donne : « Bus C3 ». */
  label: string;
  /** Couleur du mode — la même que son tracé sur la carte. */
  color: string;
  /** Trajet couvert par le segment, « Part-Dieu → Bellecour ». */
  route: string;
  /** Distance du segment, « 4,0 km » ou « 400 m ». */
  distanceLabel: string;
  /** Facteur appliqué, « 95 g/km » — ce qui rend la ligne vérifiable. */
  factorLabel: string;
  /** Empreinte du segment, « 380 g CO₂ ». */
  carbonLabel: string;
  /**
   * Part du segment dans le total, en pourcentage entier — largeur de la barre.
   * `0` quand le total est nul : un itinéraire à zéro gramme n'a pas de
   * répartition à montrer, et diviser par zéro en produirait une absurde.
   */
  sharePercent: number;
}

/** Comparaison « et si vous y étiez allé en voiture ». */
export interface CarbonComparison {
  /** Empreinte de la référence voiture, « 1,2 kg CO₂ ». */
  carLabel: string;
  /** CO₂ évité, « 785 g CO₂ ». */
  avoidedLabel: string;
  /** Part évitée du trajet en voiture, en pourcentage entier (0 si la référence est nulle). */
  avoidedPercent: number;
}

/** Détail carbone prêt à peindre. */
export interface CarbonBreakdown {
  rows: CarbonBreakdownRow[];
  /** Total de l'itinéraire, « 392 g CO₂ ». */
  totalLabel: string;
  /** `null` quand la référence voiture est nulle (itinéraire de distance nulle). */
  comparison: CarbonComparison | null;
  /**
   * Le tableau dit en une phrase, pour les technologies d'assistance.
   *
   * Un tableau de barres colorées énoncé cellule par cellule donne « Bus, 4
   * kilomètres, 95, 380 » — une suite de nombres sans verbe. Cette phrase est ce
   * qu'un lecteur d'écran annonce à la place (C7 — WCAG 1.1.1).
   */
  description: string;
}

/** Pourcentage entier de `part` dans `whole`, borné à [0, 100]. */
function share(part: number, whole: number): number {
  if (!Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)));
}

/**
 * Traduit le détail carbone d'un itinéraire en lignes affichables (UF-501).
 *
 * Les lignes de `carbon.segments` sont appariées **par position** aux
 * `itinerary.segments` : c'est le contrat publié par l'API, les deux tableaux
 * sortant du même parcours côté serveur. L'appariement sert uniquement à
 * récupérer les libellés (« Part-Dieu → Bellecour », numéro de ligne) que le
 * détail carbone ne duplique pas — c'était le sens de ne pas les y répéter (C5).
 *
 * @param itinerary Itinéraire sélectionné dans le panneau de résultats
 * @returns Le détail prêt à peindre, ou `null` si l'itinéraire n'en porte
 * pas — un itinéraire servi depuis un cache antérieur à ce ticket n'a pas de
 * champ `carbon`, et l'écran doit alors se taire plutôt que d'inventer (C10)
 */
export function describeCarbonBreakdown(itinerary: Itinerary): CarbonBreakdown | null {
  const footprint: CarbonFootprint | undefined = itinerary.carbon;
  if (!footprint || footprint.segments.length === 0) return null;

  const rows: CarbonBreakdownRow[] = footprint.segments.map((line, index) => {
    const segment = itinerary.segments[index];
    const style = MODE_TRACK_STYLES[line.mode];
    const label = segment?.line ? `${style.label} ${segment.line}` : style.label;

    return {
      key: `${itinerary.id}:carbon:${index}`,
      mode: line.mode,
      icon: MODE_ICONS[line.mode],
      label,
      color: style.color,
      route: segment ? `${segment.from} → ${segment.to}` : label,
      distanceLabel: formatDistance(line.distanceMeters),
      factorLabel: `${line.factorGramsPerKm} g/km`,
      carbonLabel: formatCarbon(line.grams),
      sharePercent: share(line.grams, footprint.totalGrams),
    };
  });

  const comparison: CarbonComparison | null =
    footprint.carEquivalentGrams > 0
      ? {
          carLabel: formatCarbon(footprint.carEquivalentGrams),
          avoidedLabel: formatCarbon(footprint.avoidedGrams),
          avoidedPercent: share(footprint.avoidedGrams, footprint.carEquivalentGrams),
        }
      : null;

  const spoken = rows.map(
    (row) => `${row.label}, ${row.distanceLabel} à ${row.factorLabel}, ${row.carbonLabel}`,
  );

  const sentences = [
    `Détail de l'empreinte : ${formatCarbon(footprint.totalGrams)} au total`,
    spoken.join(' ; '),
  ];
  if (comparison) {
    sentences.push(
      `Le même trajet seul en voiture aurait émis ${comparison.carLabel}, ` +
        `soit ${comparison.avoidedLabel} évités`,
    );
  }

  return {
    rows,
    totalLabel: formatCarbon(footprint.totalGrams),
    comparison,
    description: `${sentences.join('. ')}.`,
  };
}
