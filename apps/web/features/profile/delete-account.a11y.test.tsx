import type { DeleteAccountResult } from '@urbanflow/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '../../test/axe';
import {
  DELETE_CONFIRMATION_WORD,
  DeleteAccountCard,
  isDeletionConfirmed,
} from './delete-account-card';

const deleteAccount = vi.fn();
const forgetSession = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return { ...actual, apiClient: { deleteAccount: () => deleteAccount() } };
});

vi.mock('../auth/session-provider', () => ({
  useSession: () => ({ user: { id: 'user-1', email: 'marie@example.org' }, forgetSession }),
}));

const ERASED: DeleteAccountResult = {
  deletedUserId: 'user-1',
  deletedSearchHistoryCount: 3,
  deletedMobilityProfile: true,
  deletedAt: '2026-08-29T10:00:00.000Z',
};

/** Ouvre le panneau de confirmation et y saisit le mot demandé. */
function armDeletion(word: string = DELETE_CONFIRMATION_WORD) {
  fireEvent.click(screen.getByRole('button', { name: /supprimer mon compte et mes données/i }));
  fireEvent.change(screen.getByLabelText(/pour confirmer/i), { target: { value: word } });
}

/**
 * Suppression de compte (UF-603) — recette 3 du ticket et accessibilité (C7).
 *
 * Deux choses sont vérifiées ici, et elles ne sont pas de même nature.
 *
 * La première est un **garde-fou** : l'action est irréversible et silencieuse,
 * donc aucun chemin ne doit y mener en un seul clic. C'est le seul écran du
 * produit où un défaut d'ergonomie détruit des données.
 *
 * La seconde est la **restitution** : l'API rend le décompte de ce qu'elle a
 * effacé, et l'écran doit le montrer. Un droit exercé sans preuve d'exécution
 * n'est pas vérifiable, ni par l'utilisateur ni par la recette.
 */
describe('suppression de compte — RGPD art. 17 et WCAG 2.1 AA', () => {
  beforeEach(() => {
    deleteAccount.mockReset().mockResolvedValue(ERASED);
    forgetSession.mockReset();
    vi.useRealTimers();
  });

  it('ne viole aucune règle AA, panneau de confirmation ouvert', async () => {
    render(<DeleteAccountCard />);
    armDeletion();

    await expectNoA11yViolations();
  });

  it('ne supprime rien tant que le mot de confirmation n’est pas saisi', () => {
    render(<DeleteAccountCard />);
    fireEvent.click(screen.getByRole('button', { name: /supprimer mon compte et mes données/i }));

    const confirm = screen.getByRole('button', { name: /supprimer définitivement/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    // Même forcé, le clic ne déclenche aucun appel : le garde-fou est dans la
    // fonction, pas seulement dans l'attribut `disabled`.
    fireEvent.click(confirm);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('arme le bouton une fois le mot saisi, casse et espaces tolérés', () => {
    render(<DeleteAccountCard />);
    armDeletion('  supprimer  ');

    const confirm = screen.getByRole('button', { name: /supprimer définitivement/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it('affiche le décompte de ce qui a été effacé avant de rendre la main', async () => {
    render(<DeleteAccountCard />);
    armDeletion();
    fireEvent.click(screen.getByRole('button', { name: /supprimer définitivement/i }));

    // Preuve d'exécution : « 3 trajets », pas un simple « c'est fait ».
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/3 trajets/i);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it('annonce l’échec en alerte et affirme que rien n’a été supprimé (WCAG 3.3.1)', async () => {
    deleteAccount.mockRejectedValue(new Error('network down'));
    render(<DeleteAccountCard />);
    armDeletion();
    fireEvent.click(screen.getByRole('button', { name: /supprimer définitivement/i }));

    const alert = await screen.findByRole('alert');
    // Le message doit lever le doute : après un échec, le compte est intact.
    expect(alert.textContent).toMatch(/intact/i);
    expect(forgetSession).not.toHaveBeenCalled();
    await expectNoA11yViolations();
  });

  it('rend la main à l’écran de connexion avec le bon motif', async () => {
    vi.useFakeTimers();
    render(<DeleteAccountCard />);
    armDeletion();
    fireEvent.click(screen.getByRole('button', { name: /supprimer définitivement/i }));

    await vi.waitFor(() => expect(deleteAccount).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(2000);

    // `account-deleted` et non `signed-out` : « vous avez été déconnecté »
    // laisserait croire qu'il suffit de se reconnecter.
    expect(forgetSession).toHaveBeenCalledWith('account-deleted');
    vi.useRealTimers();
  });

  it('laisse annuler sans rien appeler', async () => {
    render(<DeleteAccountCard />);
    armDeletion();
    fireEvent.click(screen.getByRole('button', { name: /^annuler$/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /supprimer définitivement/i })).toBeNull(),
    );
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('oriente vers le simple retrait de consentement, moins radical', () => {
    render(<DeleteAccountCard />);

    // Beaucoup de suppressions de compte ne visent en réalité qu'à couper la
    // géolocalisation : le dire évite un effacement définitif inutile (C8).
    expect(screen.getByText(/interrupteur ci-dessus suffit/i)).toBeDefined();
  });
});

/** Le comparateur est testé à part : il porte le garde-fou, sans dépendre du DOM. */
describe('isDeletionConfirmed', () => {
  it('accepte le mot attendu, quelles que soient la casse et les espaces', () => {
    expect(isDeletionConfirmed('SUPPRIMER')).toBe(true);
    expect(isDeletionConfirmed(' supprimer ')).toBe(true);
  });

  it('refuse tout le reste, y compris une saisie partielle', () => {
    expect(isDeletionConfirmed('')).toBe(false);
    expect(isDeletionConfirmed('SUPPRIM')).toBe(false);
    expect(isDeletionConfirmed('SUPPRIMER MON COMPTE')).toBe(false);
  });
});
