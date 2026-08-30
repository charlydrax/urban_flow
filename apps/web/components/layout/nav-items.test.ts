import { describe, expect, it } from 'vitest';

import { isNavItemActive, NAV_ITEMS, visibleNavItems } from './nav-items';

/**
 * Recette UF-803 — les deux règles de la navigation, testées sur le modèle et
 * non sur le rendu : *qui voit quoi* (recettes 2 et 4) et *quel onglet est
 * allumé*. La barre d'onglets et le rail consommant la même liste, ce qui est
 * vrai ici l'est des deux supports (C5 : pas besoin de monter jsdom pour le
 * vérifier deux fois).
 */
describe('navigation principale — entrées (UF-803)', () => {
  describe('visibilité selon l’état de session (C4 côté affichage, UF-106/UF-801)', () => {
    it('un visiteur voit le planificateur, ouvert à tous depuis UF-801', () => {
      const hrefs = visibleNavItems(false).map((item) => item.href);
      expect(hrefs).toContain('/');
    });

    it('un visiteur ne voit aucune entrée privée', () => {
      const hrefs = visibleNavItems(false).map((item) => item.href);

      // Un lien qui se solde par une redirection vers /login n'est pas une
      // navigation, c'est une impasse.
      expect(hrefs).not.toContain('/impact');
      expect(hrefs).not.toContain('/profil');
    });

    it('un visiteur se voit proposer la connexion', () => {
      expect(visibleNavItems(false).map((item) => item.href)).toContain('/login');
    });

    it('un connecté voit les trois écrans, et plus l’entrée de connexion', () => {
      const hrefs = visibleNavItems(true).map((item) => item.href);

      expect(hrefs).toEqual(['/', '/impact', '/profil']);
    });

    it('aucune entrée n’est perdue entre les deux états', () => {
      // Recette 4 : la navigation doit rester cohérente d'un état à l'autre.
      // Toute entrée du catalogue doit donc apparaître dans au moins un des deux
      // rendus — une entrée visible de personne serait du code mort.
      const seen = new Set(
        [...visibleNavItems(false), ...visibleNavItems(true)].map((i) => i.href),
      );
      expect(seen.size).toBe(NAV_ITEMS.length);
    });
  });

  describe('entrée active (aria-current, C7 — WCAG 1.4.1)', () => {
    it('marque l’entrée dont la page est ouverte', () => {
      expect(isNavItemActive('/impact', '/impact')).toBe(true);
    });

    it('marque aussi les sous-chemins d’une entrée', () => {
      // Un futur /profil/securite doit garder son onglet allumé.
      expect(isNavItemActive('/profil/securite', '/profil')).toBe(true);
    });

    it('ne compare la racine qu’à l’identique', () => {
      // En préfixe, « / » serait actif partout : l'indication d'état ne
      // vaudrait plus rien.
      expect(isNavItemActive('/impact', '/')).toBe(false);
      expect(isNavItemActive('/', '/')).toBe(true);
    });

    it('ne confond pas deux routes qui partagent un préfixe de texte', () => {
      expect(isNavItemActive('/impacts-passes', '/impact')).toBe(false);
    });

    it('n’allume jamais deux entrées à la fois', () => {
      for (const pathname of ['/', '/impact', '/profil', '/login']) {
        const active = NAV_ITEMS.filter((item) => isNavItemActive(pathname, item.href));
        expect(active.length, `chemin ${pathname}`).toBeLessThanOrEqual(1);
      }
    });
  });

  it('chaque entrée porte un libellé écrit — jamais un picto seul (C7 — WCAG 1.1.1)', () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.trim().length, item.href).toBeGreaterThan(0);
    }
  });
});
