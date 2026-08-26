import { distanceMeters, type LatLng } from '../../transport/gbfs/distance';

/**
 * Modèle de déplacement des portions que **nous** construisons (UF-401).
 *
 * ## Pourquoi ce fichier existe
 *
 * Les trajets en transports en commun viennent d'OpenTripPlanner : durées,
 * distances et tracés sont calculés sur le réseau réel. Les portions que la
 * fusion ajoute — marche jusqu'à une station Vélo'v, coup de pédale d'une
 * borne à l'autre — n'ont, elles, aucun moteur derrière. Il faut donc les
 * estimer, et le faire au même endroit pour tout le planificateur.
 *
 * ## Ce que ce modèle assume
 *
 * Une estimation, pas un calcul d'itinéraire. Elle part d'une distance à vol
 * d'oiseau, lui applique un **facteur de détour** (on ne traverse pas les
 * immeubles) puis une vitesse moyenne. C'est suffisant pour comparer des
 * options entre elles et pour ne pas mentir à quelques minutes près sur des
 * portions de quelques centaines de mètres ; ça ne remplacerait pas un routeur
 * piéton ou cyclable, qui reste la bonne réponse le jour où le produit en
 * aura un (le graphe OSM est déjà chargé dans OTP — UF-301).
 *
 * Les valeurs choisies sont volontairement **prudentes** : sur-estimer une
 * marche de rabattement fait perdre une option à l'usager, la sous-estimer lui
 * fait rater son tram.
 *
 * Couvre : F2 (construction des segments non-TC), C5 (aucun appel réseau
 * supplémentaire : tout est calculé en mémoire à partir de la collecte).
 */

/**
 * Vitesse de marche retenue, en mètres par minute (4,8 km/h).
 *
 * En deçà de la vitesse « de promenade » souvent citée (5 km/h) : un
 * déplacement urbain comporte des feux, des traversées et des attentes que la
 * distance ne raconte pas.
 */
export const WALK_SPEED_METERS_PER_MINUTE = 80;

/**
 * Vitesse de vélo retenue, en mètres par minute (13,2 km/h).
 *
 * Vitesse *de porte à porte* d'un vélo en libre-service, pas vitesse de
 * pointe : elle intègre les feux, le déverrouillage à la borne et le fait
 * qu'un Vélo'v est lourd. Les études de trafic urbain placent la vitesse
 * commerciale du vélo entre 12 et 15 km/h ; on prend le bas de la fourchette.
 */
export const BIKE_SPEED_METERS_PER_MINUTE = 220;

/**
 * Temps forfaitaire pour prendre puis rendre un vélo en libre-service, en
 * minutes.
 *
 * Compté explicitement plutôt que fondu dans la vitesse : c'est un coût *fixe*
 * qui pénalise les trajets courts et disparaît sur les longs. Le fondre ferait
 * paraître un saut de puce à vélo plus rapide qu'il ne l'est, et c'est
 * précisément le cas où la marche gagne.
 */
export const BIKE_HANDLING_MINUTES = 3;

/**
 * Facteur de détour appliqué à une distance à vol d'oiseau pour la marche.
 *
 * Le tissu urbain lyonnais est majoritairement en damier : le rapport entre
 * chemin réel et vol d'oiseau y tourne autour de 1,3. On ne cherche pas la
 * précision au mètre, mais à ne pas annoncer 300 m là où on en marchera 400.
 */
export const WALK_DETOUR_FACTOR = 1.3;

/**
 * Facteur de détour du vélo **sans** aménagement cyclable identifié.
 *
 * Plus élevé que celui de la marche : un vélo suit les sens de circulation, les
 * quais et les ponts, là où un piéton coupe par une place ou une traboule.
 */
export const BIKE_DETOUR_FACTOR_UNSUPPORTED = 1.45;

/**
 * Facteur de détour du vélo sur un corridor **entièrement** couvert par des
 * aménagements cyclables connus (UF-304).
 *
 * C'est l'usage concret des tronçons PostGIS dans la fusion : un corridor
 * desservi par les Voies Lyonnaises se parcourt plus directement et plus
 * sûrement qu'une traversée improvisée. Le gain est modeste et assumé comme
 * tel — il départage deux options plausibles, il ne fabrique pas un raccourci.
 */
export const BIKE_DETOUR_FACTOR_SUPPORTED = 1.2;

/**
 * Distance réellement parcourue à pied entre deux points.
 *
 * @param from Point de départ (WGS84)
 * @param to Point d'arrivée (WGS84)
 * @returns Distance estimée en mètres, arrondie au mètre
 */
export function walkDistanceMeters(from: LatLng, to: LatLng): number {
  return Math.round(distanceMeters(from, to) * WALK_DETOUR_FACTOR);
}

/**
 * Distance réellement parcourue à vélo entre deux points.
 *
 * @param from Point de départ (WGS84)
 * @param to Point d'arrivée (WGS84)
 * @param cycleCoverage Part du corridor couverte par un aménagement cyclable
 *   connu, entre 0 et 1 (voir `cycle-coverage.ts`)
 * @returns Distance estimée en mètres, arrondie au mètre
 */
export function bikeDistanceMeters(from: LatLng, to: LatLng, cycleCoverage = 0): number {
  const ratio = clampRatio(cycleCoverage);
  // Interpolation linéaire entre les deux facteurs : un corridor à moitié
  // aménagé se comporte à mi-chemin des deux situations.
  const detour =
    BIKE_DETOUR_FACTOR_UNSUPPORTED -
    ratio * (BIKE_DETOUR_FACTOR_UNSUPPORTED - BIKE_DETOUR_FACTOR_SUPPORTED);
  return Math.round(distanceMeters(from, to) * detour);
}

/**
 * Durée d'une marche, à partir de la distance réellement parcourue.
 *
 * Toujours **au moins une minute** dès qu'il y a une distance : un segment
 * annoncé à zéro minute laisserait croire à une téléportation, et fausserait la
 * comparaison avec les options qui, elles, comptent ce temps.
 *
 * @param meters Distance à parcourir à pied, en mètres
 * @returns Durée en minutes entières
 */
export function walkDurationMinutes(meters: number): number {
  if (meters <= 0) return 0;
  return Math.max(1, Math.round(meters / WALK_SPEED_METERS_PER_MINUTE));
}

/**
 * Durée d'un trajet à vélo en libre-service, prise et restitution comprises.
 *
 * @param meters Distance à parcourir à vélo, en mètres
 * @returns Durée en minutes entières, jamais inférieure au temps de manipulation
 */
export function bikeDurationMinutes(meters: number): number {
  if (meters <= 0) return 0;
  return Math.max(1, Math.round(meters / BIKE_SPEED_METERS_PER_MINUTE + BIKE_HANDLING_MINUTES));
}

/** Ramène une part quelconque dans l'intervalle [0, 1] (une part n'a pas de sens hors de là). */
function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
