import { describe, expect, it } from 'vitest';

import {
  type ConsentStorage,
  forgetGuestGeolocationConsent,
  GUEST_GEOLOCATION_CONSENT_KEY,
  readGuestGeolocationConsent,
  rememberGuestGeolocationConsent,
} from './geolocation-consent';

/**
 * Recette 1 d'UF-802, versant RGPD : l'accord d'un visiteur sans compte est
 * mémorisé sur son appareil, relu sans réseau, et retirable (C8).
 *
 * Le stockage est injecté : le module est pur, la suite tourne donc dans
 * l'environnement `node` de Vitest, sans jsdom (voir `vitest.config.ts`).
 */
describe('consentement géoloc d’un invité (UF-802 — C8)', () => {
  /** Double de `localStorage` — un objet, trois méthodes, aucune magie. */
  function fakeStorage(initial: Record<string, string> = {}): ConsentStorage {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  }

  /** Stockage hostile : tout accès lève, comme en navigation privée verrouillée. */
  function throwingStorage(): ConsentStorage {
    const boom = () => {
      throw new Error('storage disabled');
    };
    return { getItem: boom, setItem: boom, removeItem: boom };
  }

  it('ne suppose aucun accord tant que rien n’a été mémorisé', () => {
    expect(readGuestGeolocationConsent(fakeStorage())).toBe(false);
  });

  it('relit l’accord donné, sans le moindre appel réseau', () => {
    const storage = fakeStorage();
    rememberGuestGeolocationConsent(storage);

    expect(storage.getItem(GUEST_GEOLOCATION_CONSENT_KEY)).not.toBeNull();
    expect(readGuestGeolocationConsent(storage)).toBe(true);
  });

  it('oublie l’accord sur demande (RGPD art. 7-3 — retrait aussi simple que l’accord)', () => {
    const storage = fakeStorage();
    rememberGuestGeolocationConsent(storage);
    forgetGuestGeolocationConsent(storage);

    expect(readGuestGeolocationConsent(storage)).toBe(false);
  });

  it('refuse une valeur qui n’est pas l’accord attendu', () => {
    // Une clé bricolée à la main dans la console du navigateur — ou laissée par
    // une version antérieure — ne doit pas passer pour un consentement.
    const storage = fakeStorage({ [GUEST_GEOLOCATION_CONSENT_KEY]: 'maybe' });

    expect(readGuestGeolocationConsent(storage)).toBe(false);
  });

  it('sans stockage utilisable, redemande l’accord plutôt que de le supposer', () => {
    // Rendu serveur, navigation privée, politique d'entreprise : l'absence de
    // stockage ne doit ni faire planter l'écran, ni ouvrir la géolocalisation.
    expect(readGuestGeolocationConsent(null)).toBe(false);
    expect(readGuestGeolocationConsent(throwingStorage())).toBe(false);
    expect(() => rememberGuestGeolocationConsent(throwingStorage())).not.toThrow();
    expect(() => forgetGuestGeolocationConsent(throwingStorage())).not.toThrow();
    expect(() => rememberGuestGeolocationConsent(null)).not.toThrow();
  });
});
