/** Rayon moyen de la Terre, en mètres (sphère de référence IUGG). */
const EARTH_RADIUS_METERS = 6_371_008.8;

/** Un point géographique en degrés décimaux WGS84. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Convertit des degrés en radians. */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Distance à vol d'oiseau entre deux points, formule de haversine.
 *
 * Calculée **en mémoire** plutôt que par PostGIS : les stations viennent d'un
 * flux externe, pas de la base. Les charger en table temporaire pour un
 * `ST_DWithin` coûterait un aller-retour SQL et une écriture disque à chaque
 * recherche, là où quelques centaines de haversines se comptent en dizaines de
 * microsecondes (C5). `ST_DWithin` reste l'outil du jour où la donnée est
 * persistée — les pistes cyclables, par exemple.
 *
 * L'approximation sphérique écarte de moins de 0,3 % de l'ellipsoïde, soit
 * moins de deux mètres sur un rayon de 500 : sans effet sur un classement de
 * stations à pied.
 *
 * @param from Point de référence (la position de l'usager)
 * @param to Point visé (une station)
 * @returns Distance en mètres, arrondie au mètre
 */
export function distanceMeters(from: LatLng, to: LatLng): number {
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);

  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.sin(deltaLng / 2) ** 2 * Math.cos(fromLat) * Math.cos(toLat);

  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a)));
}
