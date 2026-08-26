import type { CycleSegment } from '@urbanflow/shared';

import { distanceMeters, type LatLng } from '../../transport/gbfs/distance';

/**
 * Couverture cyclable d'un corridor (UF-401, exploitation de UF-304).
 *
 * ## Le problème
 *
 * La fusion sait proposer un segment vélo entre deux bornes, mais pas si ce
 * segment se fait sur une piste protégée ou dans le trafic. La différence n'est
 * pas cosmétique : elle change la vitesse réalisable, le détour subi et — c'est
 * le plus important pour le produit — le fait qu'un usager accepte ou non la
 * proposition. Les tronçons cyclables collectés aux deux extrémités (UF-304)
 * sont exactement la donnée qui permet de trancher.
 *
 * ## La méthode, et ses limites assumées
 *
 * On échantillonne le corridor à vol d'oiseau entre les deux bornes, et on
 * compte la part des points d'échantillonnage qui tombent à portée d'un
 * aménagement connu. C'est une **mesure de proximité**, pas un calage sur le
 * réseau (*map matching*) : elle répond à « ce corridor est-il équipé ? », pas
 * à « quel itinéraire cyclable exact emprunter ? ».
 *
 * Ce choix est délibéré. Un vrai calage supposerait un routeur cyclable et un
 * graphe topologique ; à l'échelle de quelques centaines de mètres et pour un
 * indicateur qui ne fait que départager deux propositions, la proximité suffit
 * et coûte quelques dizaines de microsecondes en mémoire (C5) — là où une
 * requête `ST_LineSubstring` par candidat ajouterait un aller-retour SQL à
 * chaque recherche.
 *
 * Deux biais connus, et pourquoi ils sont tolérables :
 * - un tronçon **perpendiculaire** au corridor le « couvre » sur un point ;
 *   avec un pas d'échantillonnage de 50 m, il ne pèse presque rien ;
 * - les tronçons ne sont connus qu'**autour des extrémités** (rayon UF-304) :
 *   le milieu d'un long corridor est donc structurellement sous-estimé. La
 *   couverture est ainsi un indicateur **prudent**, ce qui est le bon sens
 *   de l'erreur (on ne promet jamais un aménagement qu'on n'a pas vu).
 *
 * Couvre : F2 (portions vélo/marche appuyées sur les données cyclables),
 * C5 (calcul en mémoire, aucune requête supplémentaire), C9 (consommation de
 * géométries GeoJSON standard).
 */

/**
 * Distance en deçà de laquelle un point du corridor est considéré desservi par
 * un aménagement, en mètres.
 *
 * Trente mètres : la largeur d'une rue lyonnaise avec ses trottoirs, plus la
 * tolérance du tracé publié. En dessous, un aménagement de l'autre côté de la
 * chaussée serait ignoré alors qu'on l'emprunte ; au-dessus, une piste d'une
 * rue parallèle compterait à tort.
 */
export const FACILITY_MATCH_RADIUS_METERS = 30;

/**
 * Pas d'échantillonnage du corridor, en mètres.
 *
 * Compromis entre finesse et coût : cinquante mètres suffisent à ce qu'un
 * aménagement traversé sans être suivi ne pèse qu'un point, et bornent le
 * nombre de comparaisons sur les distances qui nous intéressent.
 */
export const CORRIDOR_SAMPLE_STEP_METERS = 50;

/**
 * Nombre maximal de points d'échantillonnage.
 *
 * Un garde-fou, pas un réglage : il borne le coût d'un corridor anormalement
 * long (une saisie fantaisiste, un point hors métropole) sans changer le
 * résultat des cas réels, qui restent bien en deçà.
 */
export const MAX_CORRIDOR_SAMPLES = 60;

/**
 * Part du corridor `from → to` couverte par un aménagement cyclable connu.
 *
 * @param from Origine du corridor (WGS84)
 * @param to Destination du corridor (WGS84)
 * @param segments Tronçons cyclables collectés autour des extrémités (UF-304)
 * @returns Une part entre 0 (aucun aménagement à portée) et 1 (corridor
 *   entièrement desservi). Vaut 0 si la source cyclable n'a rien fourni — une
 *   absence de donnée n'est pas une absence d'aménagement, mais la prudence
 *   impose de ne rien promettre.
 */
export function cycleCoverage(from: LatLng, to: LatLng, segments: readonly CycleSegment[]): number {
  if (segments.length === 0) return 0;

  const vertices = collectVertices(segments);
  if (vertices.length === 0) return 0;

  const samples = sampleCorridor(from, to);
  if (samples.length === 0) return 0;

  const covered = samples.filter((sample) => isNearAnyVertex(sample, vertices)).length;
  return covered / samples.length;
}

/**
 * Aplatit les tracés `MultiLineString` en une liste de sommets comparables.
 *
 * Les brins d'un tronçon perdent ici leur ordre, et c'est sans conséquence : on
 * mesure une proximité, pas un cheminement. Aplatir une fois pour toutes évite
 * de re-parcourir trois niveaux de tableaux à chaque point échantillonné.
 */
function collectVertices(segments: readonly CycleSegment[]): LatLng[] {
  const vertices: LatLng[] = [];
  for (const segment of segments) {
    for (const strand of segment.geometry.coordinates) {
      // GeoJSON ordonne en [lng, lat] (C9), l'inverse de nos points métier.
      for (const [lng, lat] of strand) vertices.push({ lat, lng });
    }
  }
  return vertices;
}

/**
 * Découpe le corridor en points régulièrement espacés, extrémités comprises.
 *
 * L'interpolation est linéaire sur les degrés : sur quelques kilomètres à la
 * latitude de Lyon, l'écart avec une interpolation sur la sphère est très
 * inférieur au rayon de correspondance, donc invisible pour cette mesure.
 */
function sampleCorridor(from: LatLng, to: LatLng): LatLng[] {
  const length = distanceMeters(from, to);
  if (length === 0) return [from];

  const steps = Math.min(
    MAX_CORRIDOR_SAMPLES,
    Math.max(1, Math.round(length / CORRIDOR_SAMPLE_STEP_METERS)),
  );

  const samples: LatLng[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    samples.push({
      lat: from.lat + (to.lat - from.lat) * ratio,
      lng: from.lng + (to.lng - from.lng) * ratio,
    });
  }
  return samples;
}

/** `true` dès qu'un sommet d'aménagement est à portée — la recherche s'arrête là. */
function isNearAnyVertex(sample: LatLng, vertices: readonly LatLng[]): boolean {
  return vertices.some((vertex) => distanceMeters(sample, vertex) <= FACILITY_MATCH_RADIUS_METERS);
}
