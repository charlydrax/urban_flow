import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GUEST_GEOLOCATION_CONSENT_KEY } from '../../lib/geolocation-consent';
import { useUserLocation } from './use-user-location';

const getProfile = vi.fn();
const updateProfile = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ...actual,
    apiClient: {
      getProfile: () => getProfile(),
      updateProfile: (payload: unknown) => updateProfile(payload),
    },
  };
});

/**
 * Recettes 1 et 2 d'UF-802 : « Me localiser » fonctionne pour un invité **sans
 * appel profil en amont**, et continue de fonctionner pour un compte.
 *
 * Le test porte sur le hook plutôt que sur le bouton parce que le défaut
 * corrigé est un défaut de **parcours**, pas d'affichage : l'écran rendait
 * exactement le bon bouton, c'est l'appel réseau derrière lui qui répondait
 * `401`. Ce qu'il faut donc démontrer, c'est qui est appelé — et surtout qui ne
 * l'est pas.
 *
 * Le fichier est en `.tsx` pour tomber dans la suite Vitest à environnement
 * jsdom (voir `vitest.config.ts`) : `renderHook` et `localStorage` ont besoin
 * d'un DOM, que la suite unitaire en `node` n'a pas.
 */
describe('« Me localiser » en invité et en connecté (UF-802 — C6/C8)', () => {
  /** Position que le navigateur bouchonné rend quand on la lui demande. */
  const POSITION = { coords: { latitude: 45.76, longitude: 4.86, accuracy: 25 } };

  /** Bouchonne `navigator.geolocation` : jsdom ne l'implémente pas. */
  function stubGeolocation() {
    const getCurrentPosition = vi.fn(
      (onSuccess: (position: typeof POSITION) => void) => void onSuccess(POSITION),
    );
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    return getCurrentPosition;
  }

  beforeEach(() => {
    getProfile.mockReset();
    updateProfile.mockReset();
    window.localStorage.clear();
    stubGeolocation();
  });

  it('invité : le premier clic demande l’accord sans appeler le profil', async () => {
    const { result } = renderHook(() => useUserLocation(true));

    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe('consent-required'));
    // Le cœur de la recette : aucun endpoint n'est sollicité pour un visiteur.
    expect(getProfile).not.toHaveBeenCalled();
    expect(result.current.consentScope).toBe('device');
  });

  it('invité : l’accord donné localise, sans rien envoyer au serveur', async () => {
    const { result } = renderHook(() => useUserLocation(true));

    act(() => result.current.requestLocation());
    await waitFor(() => expect(result.current.status).toBe('consent-required'));
    act(() => result.current.grantConsent());

    await waitFor(() => expect(result.current.status).toBe('located'));
    expect(result.current.position).toEqual({ lat: 45.76, lng: 4.86, accuracyMeters: 25 });
    expect(getProfile).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(GUEST_GEOLOCATION_CONSENT_KEY)).not.toBeNull();
  });

  it('invité : un accord déjà mémorisé saute le panneau au clic suivant', async () => {
    const first = renderHook(() => useUserLocation(true));
    act(() => first.result.current.requestLocation());
    await waitFor(() => expect(first.result.current.status).toBe('consent-required'));
    act(() => first.result.current.grantConsent());
    await waitFor(() => expect(first.result.current.status).toBe('located'));
    first.unmount();

    // Nouvelle visite, même appareil : on ne redemande pas ce qui a été accordé.
    const second = renderHook(() => useUserLocation(true));
    act(() => second.result.current.requestLocation());

    await waitFor(() => expect(second.result.current.status).toBe('located'));
    expect(second.result.current.status).not.toBe('consent-required');
  });

  it('invité : « Effacer ma position » retire aussi l’accord de l’appareil', async () => {
    const { result } = renderHook(() => useUserLocation(true));
    act(() => result.current.requestLocation());
    await waitFor(() => expect(result.current.status).toBe('consent-required'));
    act(() => result.current.grantConsent());
    await waitFor(() => expect(result.current.status).toBe('located'));

    act(() => result.current.forgetPosition());

    expect(result.current.position).toBeNull();
    expect(window.localStorage.getItem(GUEST_GEOLOCATION_CONSENT_KEY)).toBeNull();
    // Le message doit dire les deux effacements, pas seulement le visible (C7).
    expect(result.current.message).toMatch(/appareil/i);
  });

  it('connecté : le parcours passe toujours par le consentement enregistré côté API', async () => {
    getProfile.mockResolvedValue({ geolocationConsentAt: '2026-08-30T09:00:00.000Z' });
    const { result } = renderHook(() => useUserLocation(false));

    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe('located'));
    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(result.current.consentScope).toBe('account');
  });

  it('connecté : un accord neuf est horodaté par le serveur, pas par l’appareil', async () => {
    getProfile.mockResolvedValue({ geolocationConsentAt: null });
    updateProfile.mockResolvedValue({ geolocationConsentAt: '2026-08-30T09:00:00.000Z' });
    const { result } = renderHook(() => useUserLocation(false));

    act(() => result.current.requestLocation());
    await waitFor(() => expect(result.current.status).toBe('consent-required'));
    act(() => result.current.grantConsent());

    await waitFor(() => expect(result.current.status).toBe('located'));
    expect(updateProfile).toHaveBeenCalledWith({ geolocationConsent: true });
    // L'accord d'un compte n'a rien à faire dans le stockage du navigateur :
    // deux sources de vérité finiraient par diverger (C8).
    expect(window.localStorage.getItem(GUEST_GEOLOCATION_CONSENT_KEY)).toBeNull();
  });

  it('connecté : « Effacer ma position » ne révoque pas l’accord du compte', async () => {
    getProfile.mockResolvedValue({ geolocationConsentAt: '2026-08-30T09:00:00.000Z' });
    const { result } = renderHook(() => useUserLocation(false));
    act(() => result.current.requestLocation());
    await waitFor(() => expect(result.current.status).toBe('located'));

    act(() => result.current.forgetPosition());

    // Révocation = écran de profil (UF-107). La cacher derrière un bouton qui
    // annonce l'effacement de la position serait une surprise, pas une garantie.
    expect(result.current.position).toBeNull();
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
