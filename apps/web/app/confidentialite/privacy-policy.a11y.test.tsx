import { SEARCH_HISTORY_RETENTION_MONTHS } from '@urbanflow/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '../../test/axe';
import PrivacyPolicyPage from './page';

/**
 * Politique de confidentialité (UF-603) — recette 2 du ticket, C7 et C8.
 *
 * L'audit d'accessibilité n'est pas un ajout de confort sur cette page : c'est
 * la seule qui existe pour être **lue**, et le seul document du produit dont
 * l'illisibilité aurait une conséquence juridique. Une politique qu'un lecteur
 * d'écran énonce comme une bouillie de cellules sans en-têtes n'est pas une
 * information « fournie de manière claire » au sens de l'article 12.
 *
 * Les assertions de contenu sont volontairement peu nombreuses : elles portent
 * sur ce qui doit rester vrai, pas sur la formulation. Une seule est vérifiée
 * mot pour mot — la durée de conservation, parce qu'elle doit correspondre à ce
 * que la purge applique réellement côté API.
 */
describe('politique de confidentialité — WCAG 2.1 AA', () => {
  it('ne viole aucune règle AA', async () => {
    render(<PrivacyPolicyPage />);

    await expectNoA11yViolations();
  });

  it('donne au tableau des données une légende et des en-têtes portés', () => {
    render(<PrivacyPolicyPage />);
    const table = screen.getByRole('table');

    // Sans `<caption>` ni `scope`, chaque cellule est lue hors contexte : le
    // lecteur entend « 12 mois » sans savoir de quelle donnée il s'agit.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
    expect(within(table).getAllByRole('rowheader').length).toBeGreaterThan(0);
    expect(table.querySelector('caption')?.textContent).toMatch(/données collectées/i);
  });

  it('annonce la durée de conservation appliquée par la purge côté API', () => {
    render(<PrivacyPolicyPage />);

    // La page importe la constante partagée : le texte affiché ne peut pas
    // annoncer un délai que le serveur n'applique pas.
    expect(SEARCH_HISTORY_RETENTION_MONTHS).toBe(12);
    expect(screen.getAllByText(/12 mois/).length).toBeGreaterThan(0);
  });

  it('couvre les quatre points exigés par la recette du ticket', () => {
    render(<PrivacyPolicyPage />);

    // Données collectées, finalité, conservation, protection : les en-têtes de
    // section sont ce qui rend la page navigable au lecteur d'écran.
    const sections = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    expect(sections.join(' | ')).toMatch(/collectons/i);
    expect(sections.join(' | ')).toMatch(/position/i);
    expect(sections.join(' | ')).toMatch(/droits/i);
    expect(sections.join(' | ')).toMatch(/protégées/i);
  });

  it('renvoie vers les écrans où les droits s’exercent réellement', () => {
    render(<PrivacyPolicyPage />);

    // Décrire un droit sans dire où l'exercer le laisse théorique (C8).
    const profileLink = screen.getByRole('link', { name: /mon profil/i });
    expect(profileLink.getAttribute('href')).toBe('/profil');
  });
});
