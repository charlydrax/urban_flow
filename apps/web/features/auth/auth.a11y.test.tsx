import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '../../test/axe';
import { AuthShell } from './auth-shell';
import { LoginForm } from './login-form';
import { RegisterForm } from './register-form';

// `useRouter` n'existe pas hors du runtime Next : les formulaires s'en servent
// pour rediriger après succès, ce que l'audit ne déclenche jamais.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/login',
}));

/**
 * Audit d'accessibilité des écrans d'authentification (UF-602, C7).
 *
 * Ce sont les deux premiers formulaires rencontrés : s'ils ne sont pas
 * utilisables au clavier et au lecteur d'écran, rien de ce qui suit ne l'est.
 * Les composants sont audités **dans leur coque** (`AuthShell`), parce que
 * c'est elle qui porte le titre auquel le formulaire se relie — les auditer nus
 * validerait un fragment que la page ne rend jamais.
 */
describe('écrans d’authentification — WCAG 2.1 AA', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('réseau non sollicité par l’audit'))),
    );
  });

  it('le formulaire de connexion ne viole aucune règle AA', async () => {
    render(
      <AuthShell
        titleId="login-title"
        title="Bon retour"
        subtitle="Connectez-vous pour reprendre vos trajets."
        switchPrompt="Pas encore de compte ?"
        switchHref="/register"
        switchLabel="S'inscrire"
      >
        <LoginForm />
      </AuthShell>,
    );

    await expectNoA11yViolations();
  });

  it('le formulaire d’inscription ne viole aucune règle AA', async () => {
    render(
      <AuthShell
        titleId="register-title"
        title="Créer un compte"
        subtitle="Quelques secondes suffisent."
        switchPrompt="Déjà inscrit ?"
        switchHref="/login"
        switchLabel="Se connecter"
      >
        <RegisterForm />
      </AuthShell>,
    );

    await expectNoA11yViolations();
  });

  it('chaque champ porte un nom accessible et déclare son but (WCAG 1.3.5, 3.3.2)', () => {
    render(<LoginForm />);

    const email = screen.getByLabelText(/e-?mail/i) as HTMLInputElement;
    const password = screen.getByLabelText(/mot de passe/i) as HTMLInputElement;

    // `autocomplete` n'est pas un confort : c'est WCAG 1.3.5 (identifier le but
    // d'un champ), et ce qui rend la saisie exploitable par un gestionnaire de
    // mots de passe ou une aide à la saisie.
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(email.type).toBe('email');
    expect(password.type).toBe('password');
  });

  it('la bascule « voir le mot de passe » a un nom accessible complet (WCAG 4.1.2)', () => {
    render(<LoginForm />);

    // Le nom du bouton **change avec l'état** (« Voir » ↔ « Masquer ») plutôt
    // que de porter un `aria-pressed` : les deux motifs sont conformes, et
    // celui-ci a le mérite d'être lu identiquement par tous les lecteurs
    // d'écran. Ce que l'audit vérifie, c'est que le nom est complet — « Voir »
    // seul ne dirait pas voir *quoi*.
    expect(screen.getByRole('button', { name: /voir le mot de passe/i })).toBeDefined();
  });
});
