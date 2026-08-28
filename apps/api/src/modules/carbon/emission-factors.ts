import { TransportMode } from '../../common/enums/transport-mode.enum';

/**
 * Facteurs d'émission par mode — Service Carbone (fonctionnalité retenue).
 *
 * Fonctions **pures**, sans dépendance NestJS : la fusion multimodale (UF-401)
 * en a besoin pour valoriser chaque segment qu'elle construit, et le
 * `CarbonService` pour agréger un itinéraire. Les isoler ici évite que le
 * planificateur ait à injecter un service pour une multiplication, et permet de
 * tester le barème sans conteneur d'injection.
 *
 * ## Source
 *
 * **Base Empreinte® de l'ADEME** (anciennement Base Carbone®), poste
 * « Transport de personnes », ordres de grandeur pour un réseau urbain français
 * — https://base-empreinte.ademe.fr. Les valeurs ci-dessous sont des arrondis
 * de ces ordres de grandeur, pas des extractions ligne à ligne de la base :
 * elles sont ici pour **classer** les modes, pas pour produire un bilan
 * réglementaire (voir « Ce que le barème n'est pas », plus bas).
 *
 * ## Méthodologie
 *
 * - **Unité** : grammes de CO₂ équivalent **par passager et par kilomètre**
 *   (g CO₂e/p.km). Le passager, et non le véhicule : c'est la seule unité qui
 *   permette de comparer un bus rempli à une voiture avec un conducteur seul.
 * - **Périmètre** : « usage + amont énergie » (combustion ou production
 *   d'électricité, plus l'extraction et le raffinage du carburant). La
 *   fabrication du véhicule et l'infrastructure sont **hors périmètre**, sauf
 *   pour les mobilités partagées où elles dominent le bilan (voir `SCOOTER`).
 * - **Taux d'occupation** : moyennes de réseau pour les transports en commun,
 *   2,5 personnes pour le covoiturage, 1 pour la référence voiture.
 * - **Mix électrique** : mix français moyen, très décarboné — c'est lui qui
 *   place tram et métro juste au-dessus du vélo.
 * - **Calcul** : `grammes = facteur × distance_km`, arrondi au gramme
 *   ({@link segmentCarbonGrams}). Aucune pondération de durée, de dénivelé ni
 *   de charge instantanée : la distance est la seule variable dont le
 *   planificateur dispose pour tous les modes.
 *
 * ⚠️ **Barème provisoire, assumé comme tel.** Il donne le bon classement entre
 * modes — c'est ce dont le tri par empreinte croissante a besoin — mais pas une
 * comptabilité carbone certifiée. Un ticket dédié affinera (taux d'occupation
 * réel des lignes TCL, mix électrique horaire, distinction vélo mécanique /
 * VAE par station). Les valeurs sont regroupées ici précisément pour que cet
 * affinage ne touche qu'un seul fichier.
 */

/**
 * Grammes de CO₂e par passager et par kilomètre, par mode.
 *
 * Chaque valeur porte sa justification : un barème carbone non sourcé n'est pas
 * défendable, et ces chiffres orientent le choix de l'usager.
 */
export const GRAMS_PER_PASSENGER_KM: Readonly<Record<TransportMode, number>> = {
  /** Aucune émission attribuable au déplacement lui-même. */
  [TransportMode.WALK]: 0,
  /**
   * Vélo mécanique : 0 à l'usage. Le libre-service ajoute la régulation par
   * camion (redistribution des vélos entre stations), d'où une valeur non nulle
   * mais marginale devant tout mode motorisé.
   */
  [TransportMode.BIKE]: 2,
  /**
   * Trottinette en libre-service : le bilan est dominé par la fabrication
   * amortie sur une durée de vie courte et par la régulation, pas par
   * l'électricité consommée. C'est ce qui la place au-dessus du vélo malgré un
   * usage électrique.
   */
  [TransportMode.SCOOTER]: 25,
  /** Autobus urbain thermique, au taux d'occupation moyen d'un réseau de métropole. */
  [TransportMode.BUS]: 95,
  /** Tramway : traction électrique, mix français très décarboné. */
  [TransportMode.TRAM]: 3,
  /**
   * Métro (et funiculaires TCL, projetés sur `METRO` par le connecteur GTFS) :
   * même traction électrique que le tramway, charge moyenne un peu plus élevée.
   */
  [TransportMode.METRO]: 4,
  /**
   * Covoiturage : la référence {@link CAR_REFERENCE_GRAMS_PER_KM} rapportée à
   * un remplissage de deux personnes et demie (218 / 2,5 ≈ 88). Le mode reste
   * hors périmètre du MVP ; il est valorisé ici pour que le barème soit complet
   * si le planificateur l'active.
   */
  [TransportMode.CARPOOL]: 88,
};

/**
 * Voiture particulière moyenne, **seul à bord** — étalon de comparaison, pas un
 * mode proposé (UF-501).
 *
 * Volontairement **hors** de {@link GRAMS_PER_PASSENGER_KM} : ce tableau est
 * indexé par `TransportMode`, et y ajouter la voiture solo obligerait à créer un
 * mode que ni la fusion, ni la carte, ni le formulaire ne savent produire. Le
 * planificateur d'UrbanFlow ne propose pas de conduire seul ; il montre ce que
 * cela aurait coûté.
 *
 * ≈ 218 g CO₂e/km pour le parc français moyen (Base Empreinte ADEME, périmètre
 * usage + amont énergie). Un seul occupant, donc autant par passager que par
 * véhicule — et c'est bien le trajet que l'usager a évité en ouvrant l'app.
 */
export const CAR_REFERENCE_GRAMS_PER_KM = 218;

/**
 * Empreinte d'un segment, à partir de son mode et de sa distance.
 *
 * Arrondi au gramme : publier des décimales sur un barème d'ordre de grandeur
 * suggérerait une précision que le calcul n'a pas.
 *
 * @param mode Mode de transport du segment
 * @param distanceMeters Distance parcourue sur ce segment, en mètres
 * @returns Empreinte du segment en grammes de CO₂e (jamais négative)
 */
export function segmentCarbonGrams(mode: TransportMode, distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  return Math.round((GRAMS_PER_PASSENGER_KM[mode] * distanceMeters) / 1000);
}

/**
 * Ce que `distanceMeters` auraient coûté en voiture particulière, seul à bord.
 *
 * Même garde et même arrondi que {@link segmentCarbonGrams} : la référence et
 * l'itinéraire réel doivent être calculés de la même façon, sinon la
 * comparaison publiée compare deux méthodes autant que deux trajets.
 *
 * @param distanceMeters Distance totale du trajet, en mètres
 * @returns Empreinte de référence en grammes de CO₂e (jamais négative)
 */
export function carReferenceGrams(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  return Math.round((CAR_REFERENCE_GRAMS_PER_KM * distanceMeters) / 1000);
}
