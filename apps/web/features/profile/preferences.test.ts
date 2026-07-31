import { RoutePriority, TransportMode, type UserProfile } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import {
  buildProfilePatch,
  initialsFromEmail,
  MODE_OPTIONS,
  type ProfileDraft,
  toDraft,
  toggleMode,
  validateDraft,
} from './preferences';

/**
 * Tests de la logique du formulaire de profil (UF-107).
 *
 * Le composant React n'est pas testé ici (les tests web tournent en
 * environnement node) : c'est justement pourquoi toutes les décisions —
 * *quoi envoyer*, *quand refuser*, *quand ne rien envoyer* — sont extraites
 * dans `preferences.ts`.
 */

const profile: UserProfile = {
  id: 'user-1',
  email: 'marie.dupont@email.fr',
  createdAt: '2026-01-15T10:00:00.000Z',
  geolocationConsentAt: null,
  preferences: {
    preferredModes: [TransportMode.WALK, TransportMode.METRO],
    priority: RoutePriority.GREENEST,
    reducedMobility: false,
    maxWalkMinutes: 15,
  },
};

const draftOf = (profileToUse: UserProfile = profile): ProfileDraft => toDraft(profileToUse);

describe('toDraft', () => {
  it('derives the consent checkbox from the consent timestamp', () => {
    expect(toDraft(profile).geolocationConsent).toBe(false);
    expect(
      toDraft({ ...profile, geolocationConsentAt: '2026-07-01T08:30:00.000Z' }).geolocationConsent,
    ).toBe(true);
  });

  it('copies the mode array so editing the draft never mutates the loaded profile', () => {
    const draft = toDraft(profile);

    draft.preferences.preferredModes.push(TransportMode.BIKE);

    expect(profile.preferences.preferredModes).toEqual([TransportMode.WALK, TransportMode.METRO]);
  });
});

describe('toggleMode', () => {
  it('adds a mode that was not selected', () => {
    expect(toggleMode([TransportMode.WALK], TransportMode.BIKE)).toContain(TransportMode.BIKE);
  });

  it('removes a mode that was already selected', () => {
    expect(toggleMode([TransportMode.WALK, TransportMode.BIKE], TransportMode.WALK)).toEqual([
      TransportMode.BIKE,
    ]);
  });

  it('keeps the display order regardless of the click order', () => {
    const selection = toggleMode(toggleMode([], TransportMode.CARPOOL), TransportMode.WALK);
    const displayOrder = MODE_OPTIONS.map((option) => option.value);

    expect(selection).toEqual(displayOrder.filter((mode) => selection.includes(mode)));
  });
});

describe('validateDraft', () => {
  it('accepts a valid draft', () => {
    expect(validateDraft(draftOf())).toBeNull();
  });

  it('refuses an empty mode selection (no mode = no route)', () => {
    const draft = draftOf();
    draft.preferences.preferredModes = [];

    expect(validateDraft(draft)).toMatch(/au moins un mode/i);
  });

  it('refuses a walking duration outside the server bounds (0-60)', () => {
    const draft = draftOf();
    draft.preferences.maxWalkMinutes = 90;

    expect(validateDraft(draft)).toMatch(/entre 0 et 60/i);
  });

  it('refuses a non-integer walking duration', () => {
    const draft = draftOf();
    draft.preferences.maxWalkMinutes = Number.NaN;

    expect(validateDraft(draft)).not.toBeNull();
  });
});

describe('buildProfilePatch', () => {
  it('returns null when nothing changed (no useless request — C5)', () => {
    expect(buildProfilePatch(draftOf(), draftOf())).toBeNull();
  });

  it('sends only the fields that actually changed', () => {
    const draft = draftOf();
    draft.preferences.maxWalkMinutes = 30;

    expect(buildProfilePatch(draftOf(), draft)).toEqual({ preferences: { maxWalkMinutes: 30 } });
  });

  it('sends the consent separately from the preferences', () => {
    const draft = draftOf();
    draft.geolocationConsent = true;

    expect(buildProfilePatch(draftOf(), draft)).toEqual({ geolocationConsent: true });
  });

  it('combines profile and preferences in a single PATCH', () => {
    const draft = draftOf();
    draft.geolocationConsent = true;
    draft.preferences.priority = RoutePriority.FASTEST;
    draft.preferences.reducedMobility = true;

    expect(buildProfilePatch(draftOf(), draft)).toEqual({
      geolocationConsent: true,
      preferences: { priority: RoutePriority.FASTEST, reducedMobility: true },
    });
  });

  it('ignores a mode reordering that changes nothing', () => {
    const draft = draftOf();
    draft.preferences.preferredModes = [TransportMode.METRO, TransportMode.WALK];

    expect(buildProfilePatch(draftOf(), draft)).toBeNull();
  });

  it('detects a real change in the mode selection', () => {
    const draft = draftOf();
    draft.preferences.preferredModes = [TransportMode.WALK];

    expect(buildProfilePatch(draftOf(), draft)).toEqual({
      preferences: { preferredModes: [TransportMode.WALK] },
    });
  });
});

describe('initialsFromEmail', () => {
  it('builds initials from a first.last address', () => {
    expect(initialsFromEmail('marie.dupont@email.fr')).toBe('MD');
  });

  it('falls back to the first two letters of the local part', () => {
    expect(initialsFromEmail('marie@email.fr')).toBe('MA');
  });
});
