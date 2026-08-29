import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '../test/axe';
import PageError from './error';

// `usePathname` lit le routeur de Next : hors application, il n'y en a pas.
vi.mock('next/navigation', () => ({ usePathname: () => '/impact' }));

/**
 * Écran d'erreur des pages (UF-607) — accessibilité et contenu.
 *
 * Un écran d'erreur est le pire endroit où reléguer l'accessibilité : c'est
 * précisément le moment où l'usager est perdu, et où un lecteur d'écran doit
 * annoncer ce qui vient de se passer. On y vérifie donc les trois choses dont
 * dépend la sortie de crise : l'annonce, l'issue, et la référence à citer dans
 * un signalement.
 */
describe('écran d’erreur — WCAG 2.1 AA', () => {
  const error = Object.assign(new Error('render failed'), { digest: '1873452901' });

  beforeEach(() => {
    // Le composant signale l'erreur au montage : on intercepte l'envoi, il est
    // testé pour lui-même dans `lib/error-reporting.test.ts`.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
  });

  it('ne viole aucune règle AA', async () => {
    render(<PageError error={error} reset={() => undefined} />);

    await expectNoA11yViolations();
  });

  it('annonce l’erreur à un lecteur d’écran (WCAG 4.1.3)', () => {
    render(<PageError error={error} reset={() => undefined} />);

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
  });

  it('laisse deux issues : réessayer, ou revenir à la planification', () => {
    const reset = vi.fn();
    render(<PageError error={error} reset={reset} />);

    const retry = screen.getByRole('button', { name: /réessayer/i });
    retry.click();

    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /accueil/i }).getAttribute('href')).toBe('/');
  });

  it('affiche la référence technique, à recopier dans un signalement de bogue', () => {
    render(<PageError error={error} reset={() => undefined} />);

    // Sélectionnable dans la page, et non enfoui dans la console du
    // navigateur : c'est ce que l'usager transmet à l'équipe (docs/bug-process.md).
    expect(screen.getByText('1873452901')).toBeDefined();
  });
});
