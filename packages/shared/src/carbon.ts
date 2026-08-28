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

/**
 * Voiture particulière moyenne, **seul à bord** — étalon de comparaison, en
 * grammes de CO₂e par kilomètre (Base Empreinte ADEME, usage + amont énergie).
 *
 * Déplacée ici depuis `emission-factors.ts` par UF-505 (le module API la
 * ré-exporte) : la page « Mon impact » convertit la référence voiture en
 * **kilomètres** pour l'afficher, et cette conversion n'a de sens que si les
 * deux côtés divisent par exactement le même nombre. Deux copies du facteur,
 * c'est un jour deux distances différentes pour le même trajet.
 *
 * ⚠️ Le reste du barème (`GRAMS_PER_PASSENGER_KM`) **ne** monte pas ici : il
 * n'est consommé que par le serveur, et le publier inviterait le client à
 * recalculer des empreintes au lieu de lire celles que l'API a arrêtées.
 */
export const CAR_REFERENCE_GRAMS_PER_KM = 218;

/**
 * Une tranche de temps du suivi carbone personnel (UF-505).
 *
 * Sert deux fois : pour la période affichée en tête de la page « Mon impact »,
 * et pour chacune des barres de son graphique d'évolution. Les deux portent
 * exactement les mêmes grandeurs — un total n'a pas de sens différent selon
 * qu'il couvre trente jours ou sept.
 */
export interface CarbonPeriodTotals {
  /** Début de la tranche, inclus (ISO 8601 — C9). */
  from: string;
  /** Fin de la tranche, exclue (ISO 8601). */
  to: string;
  /** CO₂ réellement émis par les itinéraires retenus, en grammes. */
  emittedGrams: number;
  /**
   * Ce que les mêmes trajets auraient coûté **seul en voiture**, en grammes.
   *
   * Publié à côté de l'émis, et non seulement l'écart entre les deux : c'est
   * lui qui donne l'échelle. « 3 kg évités » ne dit pas si l'usager a évité un
   * dixième ou les neuf dixièmes de son empreinte possible.
   */
  carEquivalentGrams: number;
  /**
   * CO₂ évité par rapport à cette référence, en grammes — jamais négatif,
   * même règle que {@link CarbonFootprint.avoidedGrams}.
   */
  avoidedGrams: number;
  /** Nombre de trajets **valorisés** (option retenue) sur la tranche. */
  tripsCount: number;
}

/**
 * Suivi carbone personnel — réponse de `GET /api/carbon/summary` (UF-505).
 *
 * ## Ce qui est compté, et ce qui ne l'est pas
 *
 * Un trajet n'entre dans ces totaux que lorsque l'usager a **retenu une
 * option** dans la liste de résultats. Une recherche lancée puis abandonnée
 * reste dans l'historique (elle sert les rappels du planificateur) mais ne
 * pèse rien ici : compter des suggestions du serveur comme des déplacements
 * réels gonflerait le bilan de trajets que personne n'a faits.
 *
 * C'est pourquoi `unpricedTripsCount` est publié : sans lui, un usager qui
 * cherche beaucoup et choisit peu verrait un total bas sans comprendre
 * pourquoi, et croirait à un défaut de l'application.
 */
export interface CarbonSummary {
  /** Période affichée, la plus récente. */
  current: CarbonPeriodTotals;
  /**
   * La période de même durée qui précède immédiatement — le point de
   * comparaison de l'indicateur d'évolution.
   */
  previous: CarbonPeriodTotals;
  /**
   * Variation des émissions entre `previous` et `current`, en pourcentage
   * (négatif = baisse, la bonne direction).
   *
   * `null` quand la période précédente est vide : on ne divise pas par zéro,
   * et « +∞ % » n'est pas une information. L'écran dit alors qu'il n'y a pas
   * encore de quoi comparer, ce qui est la vérité pour un compte neuf.
   */
  emittedChangePercent: number | null;
  /**
   * Découpage de `current` en tranches égales, de la plus ancienne à la plus
   * récente — la série du graphique d'évolution.
   */
  buckets: CarbonPeriodTotals[];
  /**
   * Recherches de la période **sans option retenue**, donc absentes des
   * totaux. Publié par honnêteté du chiffre (voir ci-dessus).
   */
  unpricedTripsCount: number;
}

/**
 * Durées de suivi proposées par la page « Mon impact », en jours.
 * Le sélecteur de période de la maquette (« 30 jours ▾ ») n'offre que
 * celles-ci : une plage libre ferait payer des agrégats que personne ne lit (C5).
 */
export const CARBON_SUMMARY_DAYS = [7, 30, 90] as const;

/** Période de suivi acceptée par `GET /api/carbon/summary`. */
export type CarbonSummaryDays = (typeof CARBON_SUMMARY_DAYS)[number];

/** Période servie par défaut — celle de la maquette. */
export const DEFAULT_CARBON_SUMMARY_DAYS: CarbonSummaryDays = 30;

/**
 * Nombre de tranches du graphique d'évolution, quelle que soit la période.
 *
 * Quatre : c'est ce que montre la maquette (« Sem. 1 » à « Sem. 4 » pour un
 * mois), et c'est la limite au-delà de laquelle des barres deviennent
 * illisibles sur un écran de téléphone (C2).
 */
export const CARBON_SUMMARY_BUCKETS = 4;
