import { RoutePriority, TransportMode, type UserProfile } from '@urbanflow/shared';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '../../test/axe';
import { MobilityProfileForm } from './mobility-profile-form';

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

const PROFILE: UserProfile = {
  id: 'user-1',
  email: 'marie@example.org',
  createdAt: '2026-01-12T09:00:00+01:00',
  geolocationConsentAt: '2026-01-12T09:01:00+01:00',
  preferences: {
    preferredModes: [TransportMode.WALK, TransportMode.BIKE, TransportMode.BUS],
    // `RoutePriority.ECO` n'existe pas — l'énumération publie `GREENEST`
    // (UF-606, C3). Le membre absent valait `undefined` : le formulaire était
    // donc monté sans priorité sélectionnée, et l'audit d'accessibilité jugeait
    // un groupe de boutons radio vide plutôt que le groupe réel.
    priority: RoutePriority.GREENEST,
    maxWalkMinutes: 15,
    reducedMobility: false,
    monthlyCarbonGoalGrams: null,
  },
};

/**
 * Audit d'accessibilité du profil de mobilité (UF-602, C7 + C12).
 *
 * C'est le formulaire le plus riche du produit — cases à cocher multiples,
 * boutons radio, curseur, consentements — donc celui où une erreur de
 * regroupement se paie le plus cher : sans `fieldset`/`legend`, un lecteur
 * d'écran énonce dix contrôles sans jamais dire à quelle question ils répondent.
 *
 * C'est aussi l'unique endroit où la préférence PMR se règle : sa présence dans
 * le DOM, son étiquette et son texte d'aide font partie de la recette C12.
 */
describe('profil de mobilité — WCAG 2.1 AA', () => {
  beforeEach(() => {
    getProfile.mockReset().mockResolvedValue(PROFILE);
    updateProfile.mockReset().mockResolvedValue(PROFILE);
  });

  it('ne viole aucune règle AA une fois le profil chargé', async () => {
    render(<MobilityProfileForm />);
    await screen.findByRole('group', { name: /modes préférés/i });

    await expectNoA11yViolations();
  });

  it('regroupe les choix multiples sous une légende (WCAG 1.3.1)', async () => {
    render(<MobilityProfileForm />);
    await waitFor(() => expect(getProfile).toHaveBeenCalled());

    // Les deux questions à réponses multiples sont exposées comme des groupes
    // nommés : c'est ce qui transforme « case à cocher, Vélo » en « Mes modes
    // préférés — case à cocher, Vélo ».
    expect(await screen.findByRole('group', { name: /modes préférés/i })).toBeDefined();
    expect(screen.getByRole('group', { name: /priorité/i })).toBeDefined();
  });

  it('la préférence PMR est étiquetée et reliée à son explication (C12, WCAG 3.3.2)', async () => {
    render(<MobilityProfileForm />);

    const pmr = (await screen.findByLabelText(/accessibles PMR/i)) as HTMLInputElement;
    expect(pmr.type).toBe('checkbox');

    // L'aide n'est pas seulement affichée à côté : elle est **reliée**, donc
    // énoncée avec le champ et non retrouvée par hasard à la lecture linéaire.
    const describedBy = pmr.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(/fauteuil|PMR/i);
  });

  it('annonce l’échec de chargement sans le faire deviner (WCAG 3.3.1)', async () => {
    getProfile.mockRejectedValue(new Error('boom'));
    render(<MobilityProfileForm />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/préférences/i);
    await expectNoA11yViolations();
  });
});
