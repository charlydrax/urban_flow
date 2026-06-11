/**
 * Helpers de géolocalisation (C6) — étape 1 du flux de référence.
 *
 * RGPD (C8) : `getCurrentPosition` déclenche la demande de permission du
 * navigateur ; elle ne doit être appelée qu'après une action explicite de
 * l'utilisateur (bouton « Me localiser »), jamais au chargement de la page.
 */

/** Résultat normalisé d'une demande de géolocalisation. */
export type GeolocationResult =
  | { ok: true; lat: number; lng: number; accuracyMeters: number }
  | { ok: false; reason: 'unsupported' | 'denied' | 'unavailable' | 'timeout' };

/**
 * Récupère la position courante avec gestion explicite de chaque erreur GPS (C6).
 * @param timeoutMs Délai maximal d'attente (défaut 10 s)
 * @returns Position WGS84 + précision, ou la raison de l'échec (jamais d'exception)
 */
export function getCurrentPosition(timeoutMs = 10_000): Promise<GeolocationResult> {
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
      // enableHighAccuracy: false par défaut — précision suffisante en ville,
      // consommation batterie réduite (C5)
      { timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
