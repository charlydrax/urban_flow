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
 *
 * Accepte tout point porteur d'un `lat`/`lng` — position du capteur (C6) comme
 * adresse géocodée (UF-203) : la précision n'entre pas dans le formatage.
 */
export function formatCoordinates(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
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

/**
 * Délai maximal d'une **première** mesure en mode suivi (UF-806).
 *
 * Plus généreux que {@link GEOLOCATION_TIMEOUT_MS} : `enableHighAccuracy: true`
 * allume le GPS, et un premier point satellitaire demande couramment plus de
 * dix secondes en ville, façades hautes comprises. Rendre la main trop tôt
 * ferait échouer un guidage qui allait aboutir.
 */
export const GEOLOCATION_WATCH_TIMEOUT_MS = 20_000;

/** Ce que l'abonnement pousse à son appelant, mesure après mesure. */
export interface PositionWatchHandlers {
  /** Nouvelle position acceptée par le navigateur. */
  onPosition: (position: UserPosition) => void;
  /**
   * Échec **non fatal** : l'abonnement reste actif et peut reprendre tout seul.
   *
   * L'API Geolocation continue en effet d'émettre après un `TIMEOUT` ou un
   * `POSITION_UNAVAILABLE` — c'est le cas du tunnel, où le signal revient à la
   * sortie. Couper l'abonnement au premier échec obligerait l'usager à
   * relancer le guidage à chaque perte de réseau (recette 5 du ticket).
   */
  onFailure: (reason: GeolocationFailureReason) => void;
}

/**
 * S'abonne aux positions successives de l'utilisateur (C6) — le suivi continu
 * qu'exige le guidage (UF-806).
 *
 * ## Réglages inverses de ceux d'UF-202, et les deux modes coexistent
 *
 * |                      | `getCurrentPosition` (UF-202) | `watchUserPosition` (UF-806) |
 * | -------------------- | ----------------------------- | ---------------------------- |
 * | `enableHighAccuracy` | `false` — le quartier suffit  | `true` — on suit un tracé    |
 * | `maximumAge`         | `30_000` — un point récent va | `0` — jamais de point rejoué |
 * | Coût batterie (C5)   | négligeable                   | réel, d'où l'arrêt explicite |
 *
 * Remplir un champ « Départ » et se faire guider ne demandent pas la même
 * précision : à ± 500 m on retrouve un quartier, on ne sait pas dans quelle rue
 * on tourne. Et `maximumAge: 0` est ici une **obligation** : rejouer une
 * position de trente secondes ferait avancer la progression sur un point que
 * l'usager a déjà quitté.
 *
 * Les deux fonctions sont indépendantes — options locales à chaque appel, aucun
 * état partagé : ouvrir un guidage ne change rien au bouton « Me localiser »,
 * et les deux peuvent tourner en même temps (recette 4 du ticket).
 *
 * ## Éco-conception (C5) et RGPD (C8)
 *
 * Le suivi continu est ce que le produit fait de plus coûteux en batterie et de
 * plus intrusif en données. Deux garde-fous : il ne démarre que sur un geste
 * explicite (« Démarrer »), et la fonction rend **son propre arrêt** plutôt
 * qu'un identifiant à ranger quelque part — un abonnement qu'on oublie de
 * fermer est un GPS qui tourne dans le vide.
 *
 * @param handlers Rappels de position et d'échec
 * @param timeoutMs Délai maximal d'une mesure (défaut 20 s)
 * @returns Fonction d'arrêt, sûre à appeler plusieurs fois ; sur un navigateur
 * sans géolocalisation, `onFailure('unsupported')` est émis et l'arrêt ne fait rien
 */
export function watchUserPosition(
  handlers: PositionWatchHandlers,
  timeoutMs = GEOLOCATION_WATCH_TIMEOUT_MS,
): () => void {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    handlers.onFailure('unsupported');
    return () => {};
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) =>
      handlers.onPosition({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
      }),
    (error) =>
      handlers.onFailure(
        error.code === error.PERMISSION_DENIED
          ? 'denied'
          : error.code === error.TIMEOUT
            ? 'timeout'
            : 'unavailable',
      ),
    { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
  );

  // Idempotent : le démontage React et un arrêt manuel peuvent tomber tous les
  // deux, et `clearWatch` sur un identifiant déjà libéré n'est pas garanti sans
  // effet par la spécification.
  let cleared = false;
  return () => {
    if (cleared) return;
    cleared = true;
    navigator.geolocation.clearWatch(watchId);
  };
}
