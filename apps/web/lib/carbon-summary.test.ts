import { CAR_REFERENCE_GRAMS_PER_KM, type CarbonPeriodTotals } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import {
  avoidedSharePercent,
  barHeightPercent,
  bucketLabel,
  carEquivalentKm,
  changeSummary,
} from './carbon-summary';

/**
 * Mise en forme du suivi carbone personnel (UF-505).
 *
 * Ces tests figent trois promesses de l'écran « Mon impact » :
 *  1. aucun gramme n'est recalculé côté client — seules des grandeurs
 *     d'affichage sont dérivées de ce que l'API a publié ;
 *  2. un compte **sans données** ne se voit reprocher aucun chiffre : les
 *     indicateurs se taisent au lieu d'afficher un zéro qui accuse ;
 *  3. une valeur non nulle reste **visible** dans le graphique, si petite
 *     soit-elle — un trajet enregistré ne doit pas ressembler à un trou.
 */
describe('carbon-summary', () => {
  /** Totaux d'une période, tels que les publie `GET /api/carbon/summary`. */
  const totals = (overrides: Partial<CarbonPeriodTotals> = {}): CarbonPeriodTotals => ({
    from: '2026-07-29T00:00:00.000Z',
    to: '2026-08-28T00:00:00.000Z',
    emittedGrams: 13_500,
    carEquivalentGrams: 56_300,
    avoidedGrams: 42_800,
    tripsCount: 12,
    ...overrides,
  });

  describe('carEquivalentKm', () => {
    it('inverts the server-side reference with the very same factor', () => {
      // Un aller-retour exact : 20 km valorisés au barème doivent redonner
      // 20 km. Deux copies du facteur donneraient un jour deux distances
      // différentes pour le même trajet — d'où l'import depuis `shared`.
      expect(carEquivalentKm(CAR_REFERENCE_GRAMS_PER_KM * 20)).toBe(20);
    });

    it('reports nothing rather than a negative distance', () => {
      expect(carEquivalentKm(0)).toBe(0);
      expect(carEquivalentKm(-500)).toBe(0);
    });
  });

  describe('avoidedSharePercent', () => {
    it('expresses the saving as a share of the all-car reference', () => {
      // 42 800 / 56 300 ≈ 76 % — la valeur de la maquette.
      expect(avoidedSharePercent(totals())).toBe(76);
    });

    it('stays silent when there is nothing to compare against', () => {
      // Afficher « 0 % évité » à un compte neuf lui reprocherait une inaction
      // qui n'existe pas : il n'a rien enregistré, pas rien évité.
      expect(
        avoidedSharePercent(
          totals({ emittedGrams: 0, carEquivalentGrams: 0, avoidedGrams: 0, tripsCount: 0 }),
        ),
      ).toBeNull();
    });
  });

  describe('barHeightPercent', () => {
    it('scales the series against its own tallest bar', () => {
      // Échelle relative : un mois sobre reste lisible là où une échelle
      // absolue l'écraserait contre l'axe.
      expect(barHeightPercent(500, 1000)).toBe(50);
      expect(barHeightPercent(1000, 1000)).toBe(100);
    });

    it('keeps a tiny value visible instead of flattening it to nothing', () => {
      // 3 g dans un mois à 5 kg : la barre doit rester perceptible, sinon
      // l'écran montre un trou là où un trajet a bien eu lieu (C7).
      const height = barHeightPercent(3, 5000);

      expect(height).toBeGreaterThan(0);
      expect(height).toBeLessThan(5);
    });

    it('draws nothing for an empty bucket', () => {
      // Un vrai zéro, lui, doit rester un vrai zéro.
      expect(barHeightPercent(0, 5000)).toBe(0);
      expect(barHeightPercent(100, 0)).toBe(0);
    });
  });

  describe('bucketLabel', () => {
    it('labels a bucket by the day it starts', () => {
      const label = bucketLabel(totals({ from: '2026-08-05T00:00:00.000Z' }));

      expect(label).toContain('5');
      expect(label).toContain('août');
    });
  });

  describe('changeSummary', () => {
    it('reads a drop in emissions as good news, without a minus sign', () => {
      const summary = changeSummary(-20);

      // Le signe est porté par les mots : « −20 % de moins » dirait l'inverse.
      expect(summary.direction).toBe('down');
      expect(summary.label).toContain('20 %');
      expect(summary.label).toContain('moins');
      expect(summary.label).not.toContain('-20');
    });

    it('reads a rise as such', () => {
      const summary = changeSummary(18);

      expect(summary.direction).toBe('up');
      expect(summary.label).toContain('plus');
    });

    it('says there is nothing to compare rather than showing a number', () => {
      // Un compte neuf n'a pas « augmenté de l'infini ».
      const summary = changeSummary(null);

      expect(summary.direction).toBe('none');
      expect(summary.label).not.toMatch(/\d/);
    });

    it('does not dress up a flat period as progress', () => {
      expect(changeSummary(0).direction).toBe('flat');
    });
  });
});
