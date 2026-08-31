import type { Itinerary, LineStringGeometry, RouteSegment } from '@urbanflow/shared';

import type { UserPosition } from './geolocation';

/**
 * Progression le long d'un itinéraire (UF-806) — où en est-on du trajet, et
 * combien reste-t-il ?
 *
 * Module **pur** : ni React, ni MapLibre, ni Geolocation API. Il reçoit un
 * itinéraire et un point, il rend des mètres et des index. C'est ce qui le rend
 * testable dans l'environnement `node` de Vitest, alors que tout ce qui
 * l'entoure (abonnement GPS, caméra, écran) exige un navigateur — même
 * frontière que `route-map-layers.ts` face à `use-route-overlay.ts`.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il ne recalcule **aucun** itinéraire. Le tracé, les durées et les horaires
 * viennent du serveur (UF-401/UF-402) et ne sont jamais rejugés ici : ce module
 * les lit, il projette une position dessus, et il en déduit un reste. Un client
 * qui recalculerait un trajet parce que l'usager s'en écarte produirait des
 * propositions que le Service Itinéraire n'a jamais validées.
 *
 * Couvre : C6 (progression fondée sur la position mesurée et son incertitude),
 * C9 (géométries GeoJSON `[lng, lat]` lues telles que le contrat les publie),
 * C5 (aucun appel réseau — tout se calcule sur les données déjà reçues).
 */

/** Rayon terrestre moyen, en mètres (sphère WGS84 — suffisant à l'échelle urbaine). */
const EARTH_RADIUS_METERS = 6_371_008.8;

/**
 * Distance au but sous laquelle on considère l'arrivée atteinte, en mètres.
 *
 * Quarante mètres, parce que c'est l'ordre de grandeur de l'incertitude d'un
 * GPS de téléphone en ville (les valeurs d'`accuracyMeters` observées vont de
 * 10 à 50 m entre deux immeubles). Un seuil plus serré ne se déclencherait
 * jamais : l'usager serait devant la porte et l'écran continuerait à lui
 * annoncer « encore 20 m ». Un seuil plus large annoncerait l'arrivée au coin
 * de la rue précédente.
 */
export const ARRIVAL_RADIUS_METERS = 40;

/**
 * Écart au tracé au-delà duquel on prévient qu'on n'est plus dessus, en mètres.
 *
 * Soixante-quinze mètres : au-dessous, c'est le bruit du capteur et la largeur
 * d'un carrefour ; au-dessus, on est dans une autre rue. C'est un
 * **avertissement**, jamais un blocage — le guidage continue, et le module ne
 * propose pas de nouvel itinéraire (voir « Ce qu'il ne fait pas »).
 */
export const OFF_ROUTE_METERS = 75;

/** Point géographique en degrés WGS84 — le plus petit dénominateur commun du module. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Distance orthodromique entre deux points, en mètres (formule de haversine).
 *
 * Haversine et non une projection plane : à l'échelle d'un segment urbain
 * l'écart est négligeable, mais la formule ne demande aucun choix de projection
 * et reste juste partout — y compris sur un trajet qui traverserait un méridien.
 */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const latA = toRadians(a.lat);
  const latB = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Projection d'un point sur une polyligne : où l'on est, et à quelle distance du tracé. */
export interface PathProjection {
  /** Point du tracé le plus proche de la position mesurée. */
  point: GeoPoint;
  /** Distance parcourue depuis le début de la polyligne jusqu'à ce point, en mètres. */
  alongMeters: number;
  /** Longueur totale de la polyligne, en mètres. */
  lengthMeters: number;
  /** Écart entre la position mesurée et le tracé, en mètres. */
  offRouteMeters: number;
}

/**
 * Projette un point sur une polyligne `[lng, lat]`, tronçon par tronçon.
 *
 * L'interpolation se fait dans un **plan local** : les degrés de longitude sont
 * multipliés par `cos(latitude)` pour retrouver des axes à la même échelle,
 * puis on cherche le pied de la perpendiculaire par un produit scalaire. À
 * l'échelle d'un tronçon de rue, l'approximation est de l'ordre du centimètre —
 * et elle évite une trigonométrie sphérique complète pour un résultat que le
 * bruit du GPS noierait de toute façon.
 *
 * @param point Position mesurée
 * @param coordinates Sommets de la polyligne, en `[lng, lat]` (ordre GeoJSON — C9)
 * @returns Projection, ou `null` si la polyligne n'a pas au moins deux sommets
 */
export function projectOnPath(
  point: GeoPoint,
  coordinates: readonly [number, number][],
): PathProjection | null {
  if (coordinates.length < 2) return null;

  // Facteur de compression des longitudes à cette latitude : sans lui, un degré
  // de longitude vaudrait autant qu'un degré de latitude, et la perpendiculaire
  // tomberait à côté (à Lyon, l'erreur serait de l'ordre de 35 %).
  const lngScale = Math.cos((point.lat * Math.PI) / 180);
  const flatten = (lng: number, lat: number) => ({ x: lng * lngScale, y: lat });
  const target = flatten(point.lng, point.lat);

  let best: PathProjection | null = null;
  let travelled = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const [aLng, aLat] = coordinates[index];
    const [bLng, bLat] = coordinates[index + 1];
    const a = flatten(aLng, aLat);
    const b = flatten(bLng, bLat);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const squaredLength = dx * dx + dy * dy;

    // Position du pied de la perpendiculaire sur [a, b], bornée aux extrémités :
    // hors du tronçon, c'est le sommet le plus proche qui fait foi.
    const t =
      squaredLength === 0
        ? 0
        : Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / squaredLength));

    const foot: GeoPoint = { lng: aLng + (bLng - aLng) * t, lat: aLat + (bLat - aLat) * t };
    const legLength = distanceMeters({ lng: aLng, lat: aLat }, { lng: bLng, lat: bLat });
    const offRouteMeters = distanceMeters(point, foot);

    if (!best || offRouteMeters < best.offRouteMeters) {
      best = {
        point: foot,
        alongMeters: travelled + legLength * t,
        // Complétée après la boucle : la longueur totale n'est connue qu'à la fin.
        lengthMeters: 0,
        offRouteMeters,
      };
    }

    travelled += legLength;
  }

  return best ? { ...best, lengthMeters: travelled } : null;
}

/** Un segment de l'itinéraire qui porte effectivement un tracé exploitable. */
interface TracedSegment {
  /** Index dans `Itinerary.segments` — c'est lui qu'on publie, pas l'index filtré. */
  index: number;
  segment: RouteSegment;
  geometry: LineStringGeometry;
}

/**
 * Segments porteurs d'un tracé d'au moins deux points.
 *
 * `RouteSegment.geometry` est **optionnel au contrat** (« absent quand le pas
 * n'a pas produit deux points distincts »). Un guidage qui supposerait la
 * géométrie présente planterait sur le premier itinéraire contenant une
 * correspondance sur place — et ce sont justement les trajets multimodaux, le
 * cœur du produit.
 */
function tracedSegments(itinerary: Itinerary): TracedSegment[] {
  const traced: TracedSegment[] = [];
  itinerary.segments.forEach((segment, index) => {
    if (segment.geometry && segment.geometry.coordinates.length >= 2) {
      traced.push({ index, segment, geometry: segment.geometry });
    }
  });
  return traced;
}

/** Où en est le voyageur, et ce qu'il lui reste à faire. */
export interface RouteProgress {
  /** Index, dans `Itinerary.segments`, du segment en cours. */
  segmentIndex: number;
  /** Segment en cours, pour éviter à l'appelant de le rechercher. */
  segment: RouteSegment;
  /** Point du tracé sur lequel la position a été projetée — c'est lui qu'on dessine. */
  snapped: GeoPoint;
  /** Distance restante sur le segment en cours, en mètres. */
  segmentRemainingMeters: number;
  /** Durée restante estimée sur le segment en cours, en minutes (voir la docstring). */
  segmentRemainingMinutes: number;
  /** Distance restante jusqu'à l'arrivée, en mètres. */
  totalRemainingMeters: number;
  /** Durée restante estimée jusqu'à l'arrivée, en minutes. */
  totalRemainingMinutes: number;
  /** Part du trajet déjà parcourue, entre 0 et 1 — alimente la barre de progression. */
  completedRatio: number;
  /** Écart au tracé, en mètres. */
  offRouteMeters: number;
  /** `true` au-delà de {@link OFF_ROUTE_METERS} — un avertissement, pas un blocage. */
  offRoute: boolean;
  /** `true` quand le but est atteint à {@link ARRIVAL_RADIUS_METERS} près. */
  arrived: boolean;
}

/**
 * Calcule la progression d'une position mesurée sur un itinéraire (UF-806).
 *
 * ## Le segment en cours est celui dont le tracé passe le plus près
 *
 * Et non « le suivant de celui qu'on avait ». Deux raisons :
 *
 * - **on peut revenir en arrière.** Un voyageur qui rate son arrêt et repart en
 *   sens inverse doit voir la progression reculer, pas se figer. Une machine
 *   qui n'avancerait que d'un cran lui afficherait un guidage faux jusqu'au
 *   terminus ;
 * - **c'est sans état.** La fonction rend le même résultat pour la même
 *   position, quel que soit le chemin par lequel on y est arrivé : c'est ce qui
 *   la rend testable point par point, sans rejouer une session entière.
 *
 * Le prix à payer est connu : sur un aller-retour qui repasse au même endroit,
 * le point le plus proche peut appartenir aux deux passages. Le cas ne se
 * produit pas sur un itinéraire porte-à-porte, qui ne boucle pas.
 *
 * ## Les durées restantes sont des estimations, et le disent
 *
 * Aucune source ne publie de vitesse. La durée restante d'un segment est donc
 * sa durée annoncée par le serveur, **au prorata de la distance restante** : un
 * vélo à mi-parcours d'un tronçon de 11 min compte 5,5 min. C'est faux dans le
 * détail (une côte ne se pédale pas comme une descente) et juste dans
 * l'ensemble — et surtout, cela ne fabrique aucune donnée que le serveur
 * n'aurait pas déjà donnée.
 *
 * Les segments **suivants** sont comptés pour leur durée entière : on n'a
 * aucune raison de les rogner tant qu'on n'y est pas.
 *
 * @param itinerary Itinéraire suivi, tel que le serveur l'a publié
 * @param position Dernière position mesurée
 * @returns Progression, ou `null` si aucun segment de l'itinéraire ne porte de
 * tracé exploitable — l'appelant doit alors dire qu'il ne peut pas guider
 * plutôt que d'afficher une progression inventée
 */
export function computeRouteProgress(
  itinerary: Itinerary,
  position: UserPosition,
): RouteProgress | null {
  const traced = tracedSegments(itinerary);
  if (traced.length === 0) return null;

  let best: { traced: TracedSegment; projection: PathProjection } | null = null;

  for (const candidate of traced) {
    const projection = projectOnPath(position, candidate.geometry.coordinates);
    if (!projection) continue;
    if (!best || projection.offRouteMeters < best.projection.offRouteMeters) {
      best = { traced: candidate, projection };
    }
  }

  if (!best) return null;

  const { segment, index } = best.traced;
  const { alongMeters, lengthMeters, offRouteMeters } = best.projection;

  const segmentRemainingMeters = Math.max(0, lengthMeters - alongMeters);
  // Part du segment qu'il reste à faire, bornée à [0, 1] : une polyligne de
  // longueur nulle (deux points confondus) donnerait sinon une division par zéro.
  const remainingRatio = lengthMeters > 0 ? segmentRemainingMeters / lengthMeters : 0;

  // Segments postérieurs à celui-ci, comptés en entier — leur tracé peut
  // manquer, leur durée et leur distance sont toujours là.
  const laterSegments = itinerary.segments.slice(index + 1);
  const laterMeters = laterSegments.reduce((sum, later) => sum + later.distanceMeters, 0);
  const laterMinutes = laterSegments.reduce((sum, later) => sum + later.durationMinutes, 0);

  const totalRemainingMeters = segmentRemainingMeters + laterMeters;
  const totalMeters = itinerary.segments.reduce((sum, one) => sum + one.distanceMeters, 0);

  // Le but est le dernier sommet du dernier segment tracé — et non la fin du
  // segment en cours : c'est l'arrivée porte-à-porte qu'il faut détecter.
  const lastTraced = traced[traced.length - 1];
  const lastCoordinate =
    lastTraced.geometry.coordinates[lastTraced.geometry.coordinates.length - 1];
  const destination: GeoPoint = { lng: lastCoordinate[0], lat: lastCoordinate[1] };

  return {
    segmentIndex: index,
    segment,
    snapped: best.projection.point,
    segmentRemainingMeters,
    segmentRemainingMinutes: segment.durationMinutes * remainingRatio,
    totalRemainingMeters,
    totalRemainingMinutes: segment.durationMinutes * remainingRatio + laterMinutes,
    completedRatio:
      totalMeters > 0 ? Math.max(0, Math.min(1, 1 - totalRemainingMeters / totalMeters)) : 0,
    offRouteMeters,
    offRoute: offRouteMeters > OFF_ROUTE_METERS,
    arrived: distanceMeters(position, destination) <= ARRIVAL_RADIUS_METERS,
  };
}
