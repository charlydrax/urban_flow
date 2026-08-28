import { TransportMode, type CarbonFootprint, type Itinerary } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import { CARBON_GRADE_THRESHOLDS, carbonBadge, carbonGrade } from './carbon-badge';
import { contrastRatio, urbanflowColors as c } from './design-tokens';

/**
 * Badge CO₂ des cartes de résultat (UF-504).
 *
 * Ce que ces tests protègent : le niveau est lu **sur le rapport à la voiture**
 * et jamais sur une quantité absolue de grammes. Un seuil en grammes
 * classerait les trajets par longueur, et le premier long trajet en métro
 * partirait au rouge — c'est exactement la régression que la recette 2 du
 * ticket interdit.
 */
describe('carbonGrade', () => {
  /**
   * Fabrique un itinéraire dont l'empreinte vaut `share` fois la référence
   * voiture. La référence est fixée à 1 000 g pour que les parts se lisent
   * directement en grammes.
   */
  const atShare = (share: number, overrides: Partial<Itinerary> = {}): Itinerary => {
    const carEquivalentGrams = 1000;
    const totalGrams = Math.round(carEquivalentGrams * share);

    const carbon: CarbonFootprint = {
      totalGrams,
      segments: [
        {
          mode: TransportMode.BUS,
          distanceMeters: 4587,
          factorGramsPerKm: 95,
          grams: totalGrams,
        },
      ],
      carEquivalentGrams,
      avoidedGrams: Math.max(0, carEquivalentGrams - totalGrams),
    };

    return {
      id: 'itin-1',
      summary: 'Trajet d’essai',
      durationMinutes: 22,
      distanceMeters: 4587,
      carbonGrams: totalGrams,
      carbon,
      accessible: true,
      segments: [
        {
          mode: TransportMode.BUS,
          from: 'Part-Dieu',
          to: 'Bellecour',
          durationMinutes: 22,
          distanceMeters: 4587,
          carbonGrams: totalGrams,
        },
      ],
      ...overrides,
    };
  };

  it('grades a walk or bike trip as low', () => {
    expect(carbonGrade(atShare(0))).toBe('low');
    expect(carbonGrade(atShare(0.01))).toBe('low');
  });

  it('grades a bus trip as moderate', () => {
    // 95 g/p.km face aux 218 de la voiture solo : 44 %.
    expect(carbonGrade(atShare(95 / 218))).toBe('moderate');
  });

  it('grades anything past half a car ride as high', () => {
    expect(carbonGrade(atShare(0.75))).toBe('high');
    expect(carbonGrade(atShare(1))).toBe('high');
  });

  it('keeps both thresholds inclusive, so a boundary never falls upward', () => {
    expect(carbonGrade(atShare(CARBON_GRADE_THRESHOLDS.low))).toBe('low');
    expect(carbonGrade(atShare(CARBON_GRADE_THRESHOLDS.moderate))).toBe('moderate');
  });

  /**
   * Le cœur du ticket : c'est le **rapport** qui classe, pas la quantité. Un
   * long trajet en métro émet plus de grammes qu'une courte course en bus tout
   * en étant bien plus vertueux — et il doit rester vert.
   */
  it('reads the ratio and not the raw grams', () => {
    const longMetro = atShare(0.02, { carbonGrams: 20 });
    const shortBus = atShare(0.44, { carbonGrams: 440 });

    // Même référence ici, donc on la déforme pour que le métro pèse *plus* en
    // valeur absolue que le bus tout en restant proportionnellement minuscule.
    const heavyButClean: Itinerary = {
      ...longMetro,
      carbonGrams: 600,
      carbon: {
        ...longMetro.carbon!,
        totalGrams: 600,
        carEquivalentGrams: 40_000,
        avoidedGrams: 39_400,
      },
    };

    expect(heavyButClean.carbonGrams).toBeGreaterThan(shortBus.carbonGrams);
    expect(carbonGrade(heavyButClean)).toBe('low');
    expect(carbonGrade(shortBus)).toBe('moderate');
  });

  it('refuses to grade an itinerary that carries no carbon detail', () => {
    expect(carbonGrade(atShare(0.1, { carbon: undefined }))).toBeNull();
  });

  it('refuses to grade when the car reference is zero', () => {
    const zeroDistance = atShare(0);
    expect(
      carbonGrade({
        ...zeroDistance,
        carbon: { ...zeroDistance.carbon!, carEquivalentGrams: 0, avoidedGrams: 0 },
      }),
    ).toBeNull();
  });

  describe('carbonBadge', () => {
    it('publishes the footprint in the unit the API used', () => {
      expect(carbonBadge(atShare(0.24)).valueLabel).toBe('240 g CO₂');
      expect(carbonBadge(atShare(1.2)).valueLabel).toBe('1,2 kg CO₂');
    });

    it('states the level in words, so colour is never the only carrier (WCAG 1.4.1)', () => {
      expect(carbonBadge(atShare(0.02)).gradeLabel).toBe('Très faible empreinte');
      expect(carbonBadge(atShare(0.44)).gradeLabel).toBe('Empreinte modérée');
      expect(carbonBadge(atShare(0.9)).gradeLabel).toBe('Empreinte élevée');
    });

    it('gives each level its own tint and its own pictogram', () => {
      const levels = [atShare(0.02), atShare(0.44), atShare(0.9)].map(carbonBadge);
      const classNames = new Set(levels.map((badge) => badge.className));
      const icons = new Set(levels.map((badge) => badge.icon));

      expect(classNames.size).toBe(3);
      expect(icons.size).toBe(3);
    });

    it('turns the footprint into a comparison anyone can read', () => {
      expect(carbonBadge(atShare(0.11)).comparisonLabel).toBe('−89 % vs voiture');
    });

    it('drops the comparison rather than boasting a saving of zero', () => {
      const noSaving = atShare(1);
      expect(carbonBadge(noSaving).comparisonLabel).toBeNull();
    });

    it('still shows the value when the level cannot be established', () => {
      const badge = carbonBadge(atShare(0.1, { carbon: undefined }));

      expect(badge.grade).toBeNull();
      expect(badge.valueLabel).toBe('100 g CO₂');
      expect(badge.comparisonLabel).toBeNull();
      // La phrase est la valeur seule : qualifier ici serait inventer.
      expect(badge.description).toBe('100 g CO₂');
    });

    it('spells the badge out in one sentence for assistive technologies', () => {
      expect(carbonBadge(atShare(0.11)).description).toBe(
        'Très faible empreinte, 110 g CO₂, −89 % vs voiture',
      );
    });
  });

  /**
   * Le badge pose du **texte courant** sur un fond teinté : le seuil applicable
   * est celui du couple, pas celui de la couleur sur blanc. Les trois couples
   * viennent du bloc « Badges — états & modes » de la charte (UF-007) ; ce test
   * empêche qu'un futur ajustement de teinte les fasse passer sous AA sans que
   * rien ne le signale (C7 — WCAG 1.4.3).
   */
  it('keeps every level readable on its own tint (C7 — WCAG 1.4.3)', () => {
    const pairs: [string, string, string][] = [
      ['low', c.primaryDark, c.tintGreen],
      ['moderate', c.warning, c.tintGold],
      ['high', c.error, c.tintRed],
    ];

    for (const [grade, text, background] of pairs) {
      expect(contrastRatio(text, background), `badge ${grade}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
