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
 * ## Unité et périmètre
 *
 * Grammes de CO₂ équivalent **par passager et par kilomètre** (g CO₂e/p.km),
 * ordre de grandeur de la Base Empreinte de l'ADEME pour un réseau urbain
 * français. Périmètre « usage + amont énergie » : la fabrication du véhicule et
 * l'infrastructure ne sont pas comptées, sauf pour les mobilités partagées où
 * elles dominent le bilan (voir `SCOOTER`).
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
   * Covoiturage : voiture particulière moyenne rapportée à un remplissage de
   * deux personnes et demie. Reste hors périmètre du MVP, valorisé ici pour que
   * le barème soit complet si le mode est activé.
   */
  [TransportMode.CARPOOL]: 88,
};

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
