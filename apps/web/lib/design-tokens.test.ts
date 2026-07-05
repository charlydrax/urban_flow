import { describe, expect, it } from 'vitest';

import { contrastRatio, urbanflowColors as c } from './design-tokens';

/**
 * Recette UF-007 (C7 — WCAG 2.1 AA) : les combinaisons de couleurs de la
 * charte Figma doivent respecter les seuils de contraste — 4.5:1 pour le
 * texte courant, 3:1 pour le texte large et les composants d'interface.
 * Empêche une régression silencieuse si un token est modifié.
 */
describe('design tokens — contrastes WCAG 2.1 AA (C7)', () => {
  it('texte principal : Ink 900 sur fond de page ≥ 7:1 (AAA)', () => {
    expect(contrastRatio(c.ink, c.surface)).toBeGreaterThanOrEqual(7);
  });

  it('textes colorés sur blanc ≥ 4.5:1 (corps de texte)', () => {
    const textOnWhite = [c.primaryDark, c.action, c.actionDark, c.ink700, c.ink500, c.error, c.warning, c.gold];
    for (const color of textOnWhite) {
      expect(contrastRatio(color, '#ffffff'), `${color} sur blanc`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('boutons pleins : blanc sur primary / action ≥ 3:1 (UI, texte en gras)', () => {
    expect(contrastRatio('#ffffff', c.primary)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio('#ffffff', c.action)).toBeGreaterThanOrEqual(3);
  });

  it('modes de transport sur blanc ≥ 3:1 (tracés carte, pictos — UI)', () => {
    const modes = [c.modeBike, c.modeScooter, c.modeBus, c.modeMetro, c.modeTram];
    for (const color of modes) {
      expect(contrastRatio(color, '#ffffff'), `${color} sur blanc`).toBeGreaterThanOrEqual(3);
    }
  });

  it('indicateur de focus : action sur blanc ≥ 3:1 (WCAG 2.4.11)', () => {
    expect(contrastRatio(c.action, '#ffffff')).toBeGreaterThanOrEqual(3);
  });
});
