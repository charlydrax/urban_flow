import { TransportMode } from './transport-mode';

/**
 * Contrats du Service Carbone (fonctionnalité retenue) — empreinte d'un
 * itinéraire (UF-501) et suivi personnel.
 */

/**
 * Empreinte d'**un** segment, telle que le Service Carbone l'a calculée.
 *
 * Le facteur est publié à côté du résultat parce que c'est lui qui rend le
 * chiffre vérifiable : `grams = factorGramsPerKm × distanceMeters / 1000`. Sans
 * lui, l'usager (et le correcteur) doit croire le total sur parole ; avec lui,
 * chaque ligne se refait de tête.
 */
export interface CarbonSegmentFootprint {
  /** Mode du segment — porte à lui seul le facteur appliqué. */
  mode: TransportMode;
  /** Distance facturée, en mètres (celle du segment). */
  distanceMeters: number;
  /** Facteur du barème appliqué, en g CO₂e par passager et par kilomètre. */
  factorGramsPerKm: number;
  /** Empreinte du segment, en grammes de CO₂e, arrondie au gramme. */
  grams: number;
}

/**
 * Empreinte carbone complète d'un itinéraire (UF-501) : le total **et** son
 * détail, dans l'ordre des segments.
 *
 * `computeFootprint` rendait auparavant un simple nombre. Un total seul n'est
 * pas actionnable : il dit qu'un trajet coûte 240 g sans dire que 235 viennent
 * des huit minutes de bus. C'est ce détail qui permet à l'usager de voir *quel*
 * maillon pèse, et c'est le sens même d'un calcul « segment par segment ».
 */
export interface CarbonFootprint {
  /** Total en grammes de CO₂e — somme exacte des `segments[].grams`. */
  totalGrams: number;
  /**
   * Une entrée par segment de l'itinéraire, **dans le même ordre** que
   * `Itinerary.segments`. La correspondance est positionnelle et garantie par
   * construction : les deux tableaux sont produits par le même parcours.
   */
  segments: CarbonSegmentFootprint[];
  /**
   * Ce que la même distance aurait coûté en **voiture particulière, seul à
   * bord** (référence de comparaison du ticket UF-501).
   *
   * Publié parce qu'un gramme ne parle à personne dans l'absolu : « 240 g »
   * devient lisible en face des « 1,3 kg » de l'alternative que l'usager a
   * précisément renoncé à prendre. La voiture solo n'est pas un mode proposé
   * par le planificateur — c'est l'étalon, et rien d'autre.
   */
  carEquivalentGrams: number;
  /**
   * CO₂ **évité** par rapport à cette référence voiture, en grammes.
   *
   * Jamais négatif : un itinéraire qui ferait pire que la voiture (aucun ne le
   * fait au barème actuel) afficherait 0 évité plutôt qu'une économie
   * négative, formulation qui ne veut rien dire pour un usager.
   */
  avoidedGrams: number;
}

/** Tableau de bord carbone personnel : impact des déplacements sur une période. */
export interface CarbonDashboard {
  period: { from: string; to: string };
  totalEmittedGrams: number;
  totalAvoidedGrams: number;
  tripsCount: number;
}
