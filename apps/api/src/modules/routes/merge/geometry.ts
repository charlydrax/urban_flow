import type { LineStringGeometry } from '@urbanflow/shared';

/**
 * Assemblage de polylignes (UF-403, étendu par UF-702).
 *
 * Trois endroits construisent une `LineString` à partir de morceaux : le tracé
 * d'un pas, le tracé d'ensemble d'un itinéraire, et le recollement d'un
 * cheminement routé sur les extrémités déclarées du segment. Les trois doivent
 * appliquer exactement les mêmes règles — écarter les doublons consécutifs, et
 * ne rien publier sous deux points — sinon la carte finit par recevoir des
 * géométries que MapLibre refuse, ou des jonctions qui bâillent d'un point.
 *
 * Module **pur** : ni Nest, ni réseau, ni état.
 *
 * Couvre : C9 (RFC 7946), C5 (aucun point redondant dans la réponse).
 */

/** Un sommet GeoJSON, en `[lng, lat]` (ordre RFC 7946 — C9). */
export type Coordinate = [number, number];

/**
 * Concatène des morceaux de tracé en une `LineString` valide.
 *
 * Les points strictement identiques et consécutifs sont fondus : le dernier
 * point d'un pas est le premier du suivant, et le publier deux fois ne
 * changerait pas le rendu tout en alourdissant la réponse (C5). La comparaison
 * est faite sur l'égalité exacte, et c'est voulu : deux points « presque »
 * confondus viennent de deux mesures différentes, et lisser cela ici masquerait
 * une vraie discontinuité du tracé.
 *
 * @param parts Morceaux à enchaîner, dans l'ordre du trajet
 * @returns La géométrie assemblée, ou `undefined` sous deux points — une
 *   `LineString` d'un seul sommet est invalide au sens de la RFC 7946 (C9), et
 *   il vaut mieux ne rien publier que de la faire refuser à l'affichage.
 */
export function toLineString(
  ...parts: readonly (readonly Coordinate[])[]
): LineStringGeometry | undefined {
  const coordinates: Coordinate[] = [];

  for (const part of parts) {
    for (const point of part) {
      const last = coordinates[coordinates.length - 1];
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      coordinates.push([point[0], point[1]]);
    }
  }

  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : undefined;
}
