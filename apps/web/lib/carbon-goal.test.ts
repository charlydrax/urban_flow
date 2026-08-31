import type { CarbonGoal } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import { describeCarbonGoal } from './carbon-goal';

/**
 * Objectif carbone de la page « Mon impact » (UF-805).
 *
 * Ce que ces tests protègent : un dépassement doit **se voir** comme un
 * dépassement. La tentation d'un `Math.min(100, …)` unique est forte — elle
 * ferait lire « 128 % » comme « objectif tout juste tenu », soit l'inverse de
 * ce que la page doit dire. Le chiffre et la barre disent donc volontairement
 * deux choses différentes.
 */
describe('describeCarbonGoal', () => {
  const goal = (overrides: Partial<CarbonGoal> = {}): CarbonGoal => ({
    monthlyGrams: 16_000,
    periodGrams: 16_000,
    emittedGrams: 13_500,
    usedPercent: 84,
    ...overrides,
  });

  it('reads an account below its budget as on track', () => {
    const view = describeCarbonGoal(goal(), 30)!;

    expect(view.state).toBe('on-track');
    expect(view.statusLabel).toBe('en bonne voie');
    expect(view.targetLabel).toBe('16 kg CO₂');
    expect(view.emittedLabel).toBe('13,5 kg CO₂');
  });

  it('warns before the budget is spent, not after', () => {
    const view = describeCarbonGoal(goal({ usedPercent: 85 }), 30)!;

    // 85 %, la valeur de la planche : prévenir a encore une utilité à ce
    // moment-là, alors qu'à 99 % il est trop tard pour changer le mois en cours.
    expect(view.state).toBe('close');
    expect(view.statusLabel).toBe('objectif bientôt atteint');
  });

  it('lets the figure exceed 100 % while the bar stays inside its frame', () => {
    const view = describeCarbonGoal(goal({ usedPercent: 128, emittedGrams: 20_480 }), 30)!;

    expect(view.state).toBe('exceeded');
    expect(view.usedPercent).toBe(128);
    // La barre, elle, ne déborde pas : elle n'en serait pas plus lisible.
    expect(view.barPercent).toBe(100);
  });

  it('never draws a negative bar', () => {
    const view = describeCarbonGoal(goal({ usedPercent: -5 }), 30)!;

    expect(view.barPercent).toBe(0);
  });

  it('explains the proration when the window is not a month', () => {
    const view = describeCarbonGoal(
      goal({ periodGrams: 3_733, emittedGrams: 1_200, usedPercent: 32 }),
      7,
    )!;

    // Sur 7 jours, la cible affichée n'est pas le nombre que l'usager a saisi :
    // taire d'où elle vient ferait passer un prorata pour une erreur.
    expect(view.description).toContain('objectif mensuel de 16 kg CO₂ ramené à 7 jours');
  });

  it('stays silent about the proration on a 30-day window', () => {
    const view = describeCarbonGoal(goal(), 30)!;

    // Les deux coïncident : la précision serait du bruit.
    expect(view.description).not.toContain('ramené');
    expect(view.description).toContain('sur 30 jours');
  });

  it('says nothing at all when no goal has been set', () => {
    // Pas d'objectif n'est pas un objectif à zéro : l'écran propose d'en
    // définir un plutôt que d'annoncer un dépassement à un compte neuf.
    expect(describeCarbonGoal(null, 30)).toBeNull();
  });
});
