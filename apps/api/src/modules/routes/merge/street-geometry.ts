import type { Itinerary, LineStringGeometry, RouteSegment } from '@urbanflow/shared';

import { distanceMeters } from '../../transport/gbfs/distance';
import {
  streetPathKey,
  OTP_STREET_MODES,
  type StreetPathQuery,
  type StreetPoint,
} from '../../transport/street-routing.service';
import { toLineString, type Coordinate } from './geometry';

/**
 * Réinjection des cheminements routés dans les itinéraires fusionnés (UF-702).
 *
 * ## Pourquoi une étape séparée, et après la fusion
 *
 * La fusion (`itinerary-merger.ts`) est une **fonction pure et synchrone** :
 * c'est ce qui permet de tester l'algorithme multimodal sans base, sans OTP et
 * sans conteneur d'injection, et de le présenter isolément en soutenance. Y
 * faire entrer des appels réseau lui coûterait cette propriété, et transformerait
 * chaque test de fusion en test d'intégration.
 *
 * Les cheminements sont donc demandés **une fois la liste construite**, sur les
 * seuls segments retenus. L'ordre a un autre mérite : la fusion produit au plus
 * cinq itinéraires qui partagent beaucoup de marches (la marche vers une borne
 * se retrouve dans le trajet tout-vélo et dans le rabattement), et interroger
 * après coup permet de dédupliquer ce que router pendant la fusion aurait payé
 * autant de fois qu'il y a de candidats (C5).
 *
 * ## Ce que ce module ne touche pas
 *
 * Ni durées, ni distances, ni empreintes. Le cheminement rendu par OTP est
 * pourtant plus juste que la distance à vol d'oiseau corrigée d'un facteur de
 * détour (`travel-model.ts`)… mais l'adopter changerait les grammes publiés et
 * l'ordre de la liste, c'est-à-dire le résultat du planificateur, pour un
 * ticket qui porte sur l'**affichage**. Le tracé est rendu fidèle ; réconcilier
 * le modèle de distance avec le réseau réel est un autre travail, et il mérite
 * son propre ticket.
 *
 * Module **pur** : il ne connaît ni Nest ni le réseau. Il dit quels
 * cheminements demander, et il sait quoi faire des réponses.
 *
 * Couvre : C6 (tracés fidèles au réseau), C9 (LineString RFC 7946), C10
 * (dégradation gracieuse : un cheminement manquant garde sa droite).
 */

/**
 * Écart, en degrés, en deçà duquel deux points sont tenus pour confondus.
 *
 * 1e-7 degré vaut environ un centimètre : c'est le bruit de l'arrondi flottant,
 * pas un déplacement. Le seuil sert uniquement à décider s'il faut rajouter
 * l'extrémité déclarée devant le cheminement rendu — sous ce seuil, elle y est
 * déjà.
 */
const SAME_POINT_DEGREES = 1e-7;

/**
 * Rapport maximal admis entre la longueur d'un cheminement et la distance à vol
 * d'oiseau qui le sépare de ses extrémités.
 *
 * Un cheminement urbain fait rarement plus du double du vol d'oiseau ; cinq
 * laisse largement passer les vrais détours (contourner une gare, remonter au
 * pont le plus proche). Au-delà, ce n'est plus un détour, c'est qu'OTP a
 * raccroché l'une des extrémités à un tronçon isolé du réseau et a fait le tour
 * de la ville pour le rejoindre. Dessiner ce tracé serait pire que la droite :
 * il aurait l'air calculé.
 */
const MAX_DETOUR_RATIO = 5;

/**
 * Marge absolue ajoutée au plafond de détour, en mètres.
 *
 * Sans elle, un pas de trente mètres serait rejeté au moindre contournement de
 * carrefour : cinq fois trente mètres, c'est cent cinquante, et faire le tour
 * d'un pâté de maisons les dépasse. Le rapport protège les longs segments, la
 * marge protège les courts.
 */
const DETOUR_MARGIN_METERS = 300;

/**
 * Liste les cheminements à demander au routeur pour cette liste d'itinéraires.
 *
 * Seuls les segments qui remplissent les trois conditions y figurent : un mode
 * qui se route sur la voirie (marche, vélo, trottinette), un tracé encore
 * `straight` (un segment TC porte déjà sa forme GTFS — le redemander serait
 * payer un aller-retour pour la remplacer par elle-même), et deux extrémités
 * connues.
 *
 * Les extrémités sont lues **dans la géométrie du segment** et non dans un
 * champ dédié : le contrat public ne publie que des libellés de lieux, et le
 * tracé de repli d'un pas synthétisé est précisément la droite qui joint ses
 * deux points. C'est donc la même information, et elle n'a pas eu à traverser
 * le contrat pour arriver ici.
 *
 * @param itineraries Itinéraires issus de la fusion
 * @param wheelchair Exigence PMR du profil (C12) — elle change le cheminement
 *   piéton rendu, donc l'identité de la demande
 * @returns Les cheminements à router, doublons compris — la déduplication est
 *   l'affaire du service, qui seul connaît son cache
 */
export function collectStreetPathQueries(
  itineraries: readonly Itinerary[],
  wheelchair: boolean,
): StreetPathQuery[] {
  const queries: StreetPathQuery[] = [];

  for (const itinerary of itineraries) {
    for (const segment of itinerary.segments) {
      const query = toQuery(segment, wheelchair);
      if (query) queries.push(query);
    }
  }

  return queries;
}

/**
 * Remplace les droites par les cheminements obtenus, et rebâtit les tracés
 * d'ensemble.
 *
 * Un segment dont le cheminement manque — moteur arrêté, budget dépassé, aucun
 * chemin possible — **garde sa droite et son marquage `straight`** : c'est la
 * dégradation gracieuse du ticket, et le client peut l'annoncer parce que le
 * champ le dit (C10).
 *
 * La géométrie d'ensemble de chaque itinéraire est reconstruite à partir des
 * segments enrichis. La laisser telle quelle publierait deux tracés
 * contradictoires dans la même réponse : des segments qui suivent les rues et
 * un tracé global qui coupe à travers.
 *
 * @param itineraries Itinéraires issus de la fusion
 * @param paths Cheminements obtenus, indexés par `streetPathKey`
 * @param wheelchair La même exigence PMR qu'à la collecte — c'est elle qui
 *   permet de reformer les clés
 * @returns De nouveaux itinéraires ; les entrées ne sont jamais modifiées
 */
export function applyStreetGeometry(
  itineraries: readonly Itinerary[],
  paths: ReadonlyMap<string, LineStringGeometry>,
  wheelchair: boolean,
): Itinerary[] {
  if (paths.size === 0) return [...itineraries];

  return itineraries.map((itinerary) => {
    const segments = itinerary.segments.map((segment) =>
      withRoutedGeometry(segment, paths, wheelchair),
    );

    const geometry = toLineString(
      ...segments.map((segment) => segment.geometry?.coordinates ?? []),
    );

    return {
      ...itinerary,
      segments,
      // Un itinéraire dont plus aucun segment n'a de tracé n'en publie pas non
      // plus : on retire le champ plutôt que d'y laisser l'ancienne valeur.
      ...(geometry ? { geometry } : {}),
    };
  });
}

/** Traduit un segment en demande de cheminement, ou `null` s'il n'en vaut pas une. */
function toQuery(segment: RouteSegment, wheelchair: boolean): StreetPathQuery | null {
  if (OTP_STREET_MODES[segment.mode] === null) return null;
  // Un segment déjà routé n'a rien à demander. `undefined` — une réponse
  // antérieure au ticket, remontée d'un cache — est traitée comme `straight` :
  // au pire on route un tracé qui l'était déjà, au mieux on corrige une droite.
  if (segment.geometrySource === 'routed') return null;

  const ends = endpointsOf(segment);
  if (!ends) return null;

  return { mode: segment.mode, from: ends.from, to: ends.to, wheelchair };
}

/**
 * Applique le cheminement obtenu à un segment, si tout est réuni pour le faire.
 *
 * Trois raisons de garder la droite, et elles sont toutes des non-événements :
 * le segment n'a pas demandé de cheminement, le routeur n'en a pas rendu, ou le
 * cheminement rendu est manifestement aberrant (voir {@link isPlausible}).
 */
function withRoutedGeometry(
  segment: RouteSegment,
  paths: ReadonlyMap<string, LineStringGeometry>,
  wheelchair: boolean,
): RouteSegment {
  const query = toQuery(segment, wheelchair);
  if (!query) return segment;

  const routed = paths.get(streetPathKey(query));
  if (!routed || !isPlausible(routed, query)) return segment;

  const geometry = snapToEndpoints(routed, query);
  if (!geometry) return segment;

  return { ...segment, geometry, geometrySource: 'routed' };
}

/**
 * Recolle le cheminement sur les extrémités déclarées du segment.
 *
 * OTP raccroche le départ et l'arrivée au tronçon de voirie le plus proche : sa
 * polyligne commence donc quelques mètres à côté du point demandé — au bord de
 * la rue plutôt qu'à la borne Vélo'v. Sans ce recollement, chaque changement de
 * mode ouvrirait un petit trou sur la carte, et la recette du ticket
 * (« les segments se raccordent proprement bout à bout ») ne serait pas tenue.
 *
 * On **ajoute** les extrémités déclarées plutôt que de déplacer les points
 * rendus : le cheminement reste celui qu'OTP a calculé, augmenté du court trait
 * qui y mène. C'est exactement ce que fait l'usager en sortant de l'immeuble.
 */
function snapToEndpoints(
  routed: LineStringGeometry,
  query: StreetPathQuery,
): LineStringGeometry | undefined {
  const start: Coordinate = [query.from.lng, query.from.lat];
  const end: Coordinate = [query.to.lng, query.to.lat];
  const first = routed.coordinates[0];
  const last = routed.coordinates[routed.coordinates.length - 1];

  const head: Coordinate[] = first && isSamePoint(first, start) ? [] : [start];
  const tail: Coordinate[] = last && isSamePoint(last, end) ? [] : [end];

  return toLineString(head, routed.coordinates, tail);
}

/**
 * Un cheminement dont la longueur est hors de proportion avec le vol d'oiseau
 * n'est pas dessiné.
 *
 * Le cas réel : une extrémité tombe sur une impasse ou un tronçon mal raccordé
 * du réseau OSM, et OTP rejoint le point par un immense contournement. Le tracé
 * est alors *techniquement* un cheminement, et visuellement un mensonge — il
 * aurait l'air d'un calcul juste. La droite, elle, ne prétend rien.
 */
function isPlausible(routed: LineStringGeometry, query: StreetPathQuery): boolean {
  const crowFly = distanceMeters(query.from, query.to);
  return pathLengthMeters(routed.coordinates) <= crowFly * MAX_DETOUR_RATIO + DETOUR_MARGIN_METERS;
}

/** Longueur d'une polyligne, en mètres (somme des haversines de ses tronçons). */
function pathLengthMeters(coordinates: readonly Coordinate[]): number {
  let total = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    if (!previous || !current) continue;
    total += distanceMeters(
      { lat: previous[1], lng: previous[0] },
      { lat: current[1], lng: current[0] },
    );
  }

  return total;
}

/**
 * Extrémités d'un segment, lues aux deux bouts de son tracé.
 *
 * @returns `null` si le segment n'a pas de tracé exploitable — sans point de
 *   départ ni d'arrivée, il n'y a rien à demander au routeur.
 */
function endpointsOf(segment: RouteSegment): { from: StreetPoint; to: StreetPoint } | null {
  const coordinates = segment.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) return null;

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (!first || !last) return null;

  return {
    from: { lat: first[1], lng: first[0] },
    to: { lat: last[1], lng: last[0] },
  };
}

/** Deux points confondus à l'arrondi flottant près. */
function isSamePoint(a: Coordinate, b: Coordinate): boolean {
  return Math.abs(a[0] - b[0]) < SAME_POINT_DEGREES && Math.abs(a[1] - b[1]) < SAME_POINT_DEGREES;
}
