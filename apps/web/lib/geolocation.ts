/**
 * Helpers de géolocalisation (C6) — étape 1 du flux de référence (UF-202).
 *
 * RGPD (C8) : `getCurrentPosition` déclenche la demande de permission du
 * navigateur ; elle ne doit être appelée qu'après une action explicite de
 * l'utilisateur (bouton « Me localiser »), jamais au chargement de la page.
 *
 * Module **pur, sans React ni MapLibre** : il reste testable dans
 * l'environnement `node` de Vitest (`geolocation.test.ts`).
 */

/** Cause d'échec normalisée — chaque cas a son message et sa conduite à tenir. */
export type GeolocationFailureReason = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

/** Position de l'utilisateur, en degrés WGS84 (EPSG:4326 — C9). */
export interface UserPosition {
  lat: number;
  lng: number;
  /** Rayon d'incertitude annoncé par le navigateur, en mètres (C6). */
  accuracyMeters: number;
}

/** Résultat normalisé d'une demande de géolocalisation. */
export type GeolocationResult =
  | ({ ok: true } & UserPosition)
  | { ok: false; reason: GeolocationFailureReason };

/**
 * Messages affichés pour chaque échec (C6/C7) — UI en français.
 *
 * Ils disent **ce qui s'est passé** et **quoi faire ensuite** : aucun de ces cas
 * ne bloque l'application, la saisie manuelle du départ reste toujours ouverte
 * (dégradation gracieuse, recette 2 du ticket).
 */
export const GEOLOCATION_ERROR_MESSAGES: Record<GeolocationFailureReason, string> = {
  unsupported:
    "Votre navigateur ne propose pas la géolocalisation. Saisissez votre point de départ à la main : l'application reste entièrement utilisable.",
  denied:
    'Vous avez refusé la géolocalisation. Saisissez votre point de départ à la main, ou réautorisez la position dans les réglages de votre navigateur.',
  unavailable:
    'Votre position n’a pas pu être déterminée (GPS ou réseau indisponible). Saisissez votre point de départ à la main.',
  timeout:
    'La recherche de votre position a pris trop de temps. Réessayez, ou saisissez votre point de départ à la main.',
};

/** Délai maximal par défaut : au-delà, on rend la main plutôt que de faire attendre (C10). */
export const GEOLOCATION_TIMEOUT_MS = 10_000;

/**
 * Récupère la position courante avec gestion explicite de chaque erreur GPS (C6).
 *
 * `enableHighAccuracy: false` : la précision « réseau » suffit pour retrouver un
 * quartier de départ, et évite d'allumer le GPS (C5 — batterie).
 * `maximumAge: 30_000` : une position de moins de 30 s est réutilisée telle
 * quelle, sans nouvelle mesure (C5/C10).
 *
 * @param timeoutMs Délai maximal d'attente (défaut 10 s)
 * @returns Position WGS84 + précision, ou la raison de l'échec (jamais d'exception)
 */
export function getCurrentPosition(timeoutMs = GEOLOCATION_TIMEOUT_MS): Promise<GeolocationResult> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return Promise.resolve({ ok: false, reason: 'unsupported' });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        }),
      (error) =>
        resolve({
          ok: false,
          reason:
            error.code === error.PERMISSION_DENIED
              ? 'denied'
              : error.code === error.TIMEOUT
                ? 'timeout'
                : 'unavailable',
        }),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

/**
 * Convertit une position en couple `[lng, lat]` pour MapLibre / GeoJSON (C9).
 *
 * L'API Geolocation expose `latitude, longitude` ; GeoJSON impose l'ordre
 * **inverse**. Cette conversion est isolée ici pour que l'inversion ne soit
 * écrite qu'une fois — c'est l'erreur classique qui pose un marqueur en Somalie.
 */
export function toLngLat(position: UserPosition): [number, number] {
  return [position.lng, position.lat];
}

/**
 * Formate un couple de coordonnées pour l'affichage (5 décimales ≈ 1 m).
 * Tronquer plus court dégraderait la position ; plus long afficherait du bruit.
 */
export function formatCoordinates(position: UserPosition): string {
  return `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`;
}

/**
 * Formate le rayon d'incertitude en langage courant (C6 — fiabilité annoncée).
 * Au-delà du kilomètre, les mètres n'ont plus de sens : on bascule en km.
 */
export function formatAccuracy(accuracyMeters: number): string {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0) return 'précision inconnue';
  if (accuracyMeters >= 1000) {
    return `± ${(accuracyMeters / 1000).toFixed(1).replace('.', ',')} km`;
  }
  return `± ${Math.round(accuracyMeters)} m`;
}

/**
 * Libellé pré-rempli dans le champ « Départ » (recette 1 du ticket).
 *
 * Le texte reste **lisible et modifiable** : l'utilisateur voit ce qui va être
 * envoyé (transparence C8) et peut le remplacer par une adresse.
 */
export function formatPositionLabel(position: UserPosition): string {
  return `Ma position (${formatCoordinates(position)})`;
}
