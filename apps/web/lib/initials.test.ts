import { describe, expect, it } from 'vitest';

import { initialsFromEmail } from './initials';

/**
 * Déplacé depuis `features/profile/preferences.test.ts` par UF-803, en même
 * temps que la fonction : le rail de navigation l'appelle désormais aussi, et le
 * helper a quitté le module de profil pour ne plus tirer ses dépendances dans le
 * lot commun (C5 — voir `lib/initials.ts`).
 */
describe('initialsFromEmail', () => {
  it('builds initials from a first.last address', () => {
    expect(initialsFromEmail('marie.dupont@email.fr')).toBe('MD');
  });

  it('falls back to the first two letters of the local part', () => {
    expect(initialsFromEmail('marie@email.fr')).toBe('MA');
  });

  it('falls back to a placeholder when the local part is empty', () => {
    expect(initialsFromEmail('@email.fr')).toBe('?');
  });
});
