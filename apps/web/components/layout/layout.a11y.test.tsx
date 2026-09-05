import { UserRole, type SessionUser } from '@urbanflow/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SessionProvider } from '../../features/auth/session-provider';
import { expectNoA11yViolations } from '../../test/axe';
import { OfflineBanner } from '../offline/offline-banner';
import { AppNav } from './app-nav';
import { MobileBrandBar } from './mobile-brand-bar';

const pathname = vi.hoisted(() => ({ current: '/' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => pathname.current,
}));

/**
 * Audit d'accessibilité de la coque commune (UF-602, C7), mise à jour par
 * UF-803 : l'en-tête haut à trois liens et son menu hamburger ont laissé place
 * à `AppNav` — barre d'onglets basse sur mobile, rail sombre sur desktop.
 *
 * La coque est rendue sur **toutes** les pages : un défaut ici se compte autant
 * de fois qu'il y a d'écrans. C'est aussi là que vit ce qui rend la navigation
 * clavier praticable — les points de repère, et l'ordre du DOM.
 *
 * ⚠️ jsdom n'applique pas Tailwind : les variantes `lg:` n'y font rien, et les
 * deux formes de la navigation s'y confondent en un seul arbre. C'est
 * précisément pour cela qu'`AppNav` ne rend **qu'un** `<nav>` : si les deux
 * habillages étaient deux composants, l'audit ci-dessous verrait deux repères
 * homonymes. Ce que le test observe est donc bien le DOM livré au navigateur,
 * pas une approximation.
 */
describe('coque commune — WCAG 2.1 AA', () => {
  /**
   * Le rôle est posé ici, et non par les appelants : la coque de navigation ne
   * s'en sert pas — aucun de ses liens n'est réservé — et l'exiger à chaque
   * appel ferait répéter dix fois une donnée sans rapport avec ce que le test
   * observe. `Omit` plutôt qu'une liste de champs recopiée : le jour où
   * `SessionUser` en gagne un, c'est ici que la compilation le signalera.
   */
  function renderNav(user: Omit<SessionUser, 'role'> | null, path = '/') {
    pathname.current = path;
    return render(
      <SessionProvider initialUser={user ? { ...user, role: UserRole.USER } : null}>
        <MobileBrandBar />
        <AppNav />
      </SessionProvider>,
    );
  }

  it('la navigation déconnectée ne viole aucune règle AA', async () => {
    renderNav(null);
    await expectNoA11yViolations();
  });

  it('la navigation connectée ne viole aucune règle AA', async () => {
    renderNav({ id: 'user-1', email: 'marie@example.org' });
    await expectNoA11yViolations();
  });

  it('la navigation est un repère nommé, et un seul (WCAG 1.3.1, 2.4.1)', () => {
    renderNav({ id: 'user-1', email: 'marie@example.org' });

    // Nommer la navigation n'est utile que s'il peut y en avoir plusieurs — et
    // c'est le cas dès qu'un pied de page en porte une. Sans nom, un lecteur
    // d'écran annonce « navigation » deux fois sans les distinguer.
    expect(screen.getAllByRole('navigation', { name: /navigation principale/i })).toHaveLength(1);
  });

  it('l’ancien en-tête à trois liens a disparu (recette 3 d’UF-803)', () => {
    renderNav({ id: 'user-1', email: 'marie@example.org' });

    // Le menu hamburger était le seul mécanisme repliable de la coque : plus
    // aucun bouton ne doit annoncer un panneau à déplier.
    expect(screen.queryByRole('button', { name: /ouvrir le menu/i })).toBeNull();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
  });

  it('marque la page courante autrement que par la couleur (WCAG 1.4.1)', () => {
    renderNav({ id: 'user-1', email: 'marie@example.org' }, '/impact');

    const current = screen.getByRole('link', { name: /mon impact/i });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /itinéraires/i }).getAttribute('aria-current')).toBe(
      null,
    );
  });

  it('les pictogrammes sont décoratifs : le libellé porte le sens (WCAG 1.1.1)', () => {
    const { container } = renderNav(null);

    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  describe('navigation d’un visiteur sans compte (UF-801)', () => {
    it('propose le planificateur, désormais ouvert à tous', () => {
      renderNav(null);

      // Sans ce lien, un visiteur parti lire la politique de confidentialité
      // n'aurait aucun chemin de retour vers l'écran de recherche.
      expect(screen.getByRole('link', { name: /itinéraires/i })).toBeDefined();
    });

    it('ne propose pas les écrans qui exigent un compte', () => {
      renderNav(null);

      // Un lien qui se solde par une redirection vers /login n'est pas une
      // navigation, c'est une impasse.
      expect(screen.queryByRole('link', { name: /mon impact/i })).toBeNull();
      expect(screen.queryByRole('link', { name: /mon profil/i })).toBeNull();
      expect(screen.getByRole('link', { name: /connexion/i })).toBeDefined();
    });

    it('rend les trois écrans à un utilisateur connecté', () => {
      renderNav({ id: 'user-1', email: 'marie@example.org' });

      expect(screen.getByRole('link', { name: /itinéraires/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /mon impact/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /mon profil/i })).toBeDefined();
    });

    it('offre la déconnexion depuis le rail, sans passer par /profil', () => {
      renderNav({ id: 'user-1', email: 'marie@example.org' });

      expect(screen.getByRole('button', { name: /déconnexion/i })).toBeDefined();
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
