import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SessionProvider } from '../../features/auth/session-provider';
import { expectNoA11yViolations } from '../../test/axe';
import { OfflineBanner } from '../offline/offline-banner';
import { SiteHeader } from './site-header';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

/**
 * Audit d'accessibilité de la coque commune (UF-602, C7).
 *
 * L'en-tête et le bandeau hors-ligne sont rendus sur **toutes** les pages : un
 * défaut ici se compte autant de fois qu'il y a d'écrans. C'est aussi là que
 * vivent les deux mécanismes qui rendent la navigation clavier praticable — les
 * points de repère (landmarks) et le menu repliable.
 */
describe('coque commune — WCAG 2.1 AA', () => {
  function renderHeader(user: { id: string; email: string } | null) {
    return render(
      <SessionProvider initialUser={user}>
        <SiteHeader />
      </SessionProvider>,
    );
  }

  it('l’en-tête déconnecté ne viole aucune règle AA', async () => {
    renderHeader(null);
    await expectNoA11yViolations();
  });

  it('l’en-tête connecté ne viole aucune règle AA', async () => {
    renderHeader({ id: 'user-1', email: 'marie@example.org' });
    await expectNoA11yViolations();
  });

  it('la navigation est un repère nommé (WCAG 1.3.1, 2.4.1)', () => {
    renderHeader(null);

    // Nommer la navigation n'est utile que s'il peut y en avoir plusieurs — et
    // c'est le cas dès qu'un pied de page en porte une. Sans nom, un lecteur
    // d'écran annonce « navigation » deux fois sans les distinguer.
    expect(screen.getByRole('navigation', { name: /navigation principale/i })).toBeDefined();
  });

  it('le bouton du menu mobile annonce l’état du panneau qu’il pilote (WCAG 4.1.2)', () => {
    renderHeader(null);

    const toggle = screen.getByRole('button', { name: /ouvrir le menu/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    const controlled = toggle.getAttribute('aria-controls');
    expect(controlled).toBeTruthy();
    expect(document.getElementById(controlled as string)).not.toBeNull();
  });

  describe('navigation d’un visiteur sans compte (UF-801)', () => {
    it('propose le planificateur, désormais ouvert à tous', () => {
      renderHeader(null);

      // Sans ce lien, un visiteur parti lire la politique de confidentialité
      // n'aurait aucun chemin de retour vers l'écran de recherche.
      expect(screen.getByRole('link', { name: /itinéraires/i })).toBeDefined();
    });

    it('ne propose pas les écrans qui exigent un compte', () => {
      renderHeader(null);

      // Un lien qui se solde par une redirection vers /login n'est pas une
      // navigation, c'est une impasse.
      expect(screen.queryByRole('link', { name: /mon impact/i })).toBeNull();
      expect(screen.queryByRole('link', { name: /mon profil/i })).toBeNull();
      expect(screen.getByRole('link', { name: /connexion/i })).toBeDefined();
    });

    it('rend les trois liens à un utilisateur connecté', () => {
      renderHeader({ id: 'user-1', email: 'marie@example.org' });

      expect(screen.getByRole('link', { name: /itinéraires/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /mon impact/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /mon profil/i })).toBeDefined();
    });
  });

  it('le bandeau hors-ligne existe avant la coupure (WCAG 4.1.3)', async () => {
    render(<OfflineBanner />);

    // Une région live insérée au moment de l'événement n'est pas annoncée :
    // c'est la raison d'être du conteneur toujours monté, et c'est exactement
    // ce que l'audit doit empêcher de régresser.
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');

    await expectNoA11yViolations();
  });
});
