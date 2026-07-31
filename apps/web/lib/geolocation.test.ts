import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatAccuracy,
  formatCoordinates,
  formatPositionLabel,
  GEOLOCATION_ERROR_MESSAGES,
  getCurrentPosition,
  toLngLat,
  type UserPosition,
} from './geolocation';

/**
 * Recette UF-202 : les trois cas d'échec (refus / indisponible / timeout) sont
 * distingués et ne lèvent jamais d'exception, et la conversion vers l'ordre
 * GeoJSON `[lng, lat]` est verrouillée.
 *
 * `navigator` est simulé : ces tests tournent dans l'environnement `node` de
 * Vitest, sans navigateur ni permission réelle.
 */

/** Codes d'erreur de l'API Geolocation (le mock doit les porter comme le vrai objet). */
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

/** Position de référence : Part-Dieu, départ du scénario nominal du projet. */
const PART_DIEU: UserPosition = { lat: 45.76045, lng: 4.85949, accuracyMeters: 24.6 };

/** Installe un `navigator.geolocation` qui répond en succès. */
function mockSuccess(position: UserPosition) {
  const getCurrentPositionSpy = vi.fn(
    (onSuccess: PositionCallback, _onError: unknown, options?: PositionOptions) => {
      void options;
      onSuccess({
        coords: {
          latitude: position.lat,
          longitude: position.lng,
          accuracy: position.accuracyMeters,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
    },
  );
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: getCurrentPositionSpy } });
  return getCurrentPositionSpy;
}

/** Installe un `navigator.geolocation` qui échoue avec le code donné. */
function mockFailure(code: number) {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (_onSuccess: unknown, onError: PositionErrorCallback) => {
        onError({
          code,
          message: 'mock',
          PERMISSION_DENIED,
          POSITION_UNAVAILABLE,
          TIMEOUT,
        } as GeolocationPositionError);
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCurrentPosition', () => {
  it('renvoie la position et sa précision quand l’utilisateur autorise', async () => {
    mockSuccess(PART_DIEU);

    await expect(getCurrentPosition()).resolves.toEqual({ ok: true, ...PART_DIEU });
  });

  it('demande une précision réseau et un délai borné (C5/C10)', async () => {
    const spy = mockSuccess(PART_DIEU);

    await getCurrentPosition(5_000);

    expect(spy.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: false, timeout: 5_000 });
  });

  it('distingue le refus de permission (recette 2)', async () => {
    mockFailure(PERMISSION_DENIED);

    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: 'denied' });
  });

  it('distingue le timeout d’une position indisponible (recette 3)', async () => {
    mockFailure(TIMEOUT);
    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: 'timeout' });

    mockFailure(POSITION_UNAVAILABLE);
    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('signale un navigateur sans API Geolocation au lieu de planter', async () => {
    vi.stubGlobal('navigator', {});

    await expect(getCurrentPosition()).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });

  it('associe un message d’aide à chaque cause d’échec (C7)', () => {
    for (const message of Object.values(GEOLOCATION_ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe('conversions et formats', () => {
  it('inverse l’ordre des coordonnées pour MapLibre / GeoJSON (C9)', () => {
    expect(toLngLat(PART_DIEU)).toEqual([4.85949, 45.76045]);
  });

  it('affiche les coordonnées au dix-millième de degré près', () => {
    expect(formatCoordinates(PART_DIEU)).toBe('45.76045, 4.85949');
  });

  it('exprime la précision en mètres, puis en kilomètres au-delà de 1 km', () => {
    expect(formatAccuracy(24.6)).toBe('± 25 m');
    expect(formatAccuracy(2400)).toBe('± 2,4 km');
  });

  it('ne prétend pas connaître une précision absurde', () => {
    expect(formatAccuracy(Number.NaN)).toBe('précision inconnue');
    expect(formatAccuracy(-1)).toBe('précision inconnue');
  });

  it('pré-remplit un libellé de départ lisible et modifiable (recette 1)', () => {
    expect(formatPositionLabel(PART_DIEU)).toBe('Ma position (45.76045, 4.85949)');
  });
});
