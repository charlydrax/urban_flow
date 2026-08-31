import { TransportMode, type CarbonModeTotals } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import { describeCarbonModes } from './carbon-modes';
import { MODE_TRACK_STYLES } from './route-map-layers';

/**
 * Répartition des émissions par mode (UF-805).
 *
 * Ce que ces tests protègent : **rien n'est recalculé**. Les grammes viennent
 * du serveur, qui les a agrégés en base ; le module n'en tire que des parts
 * d'affichage. Et un mode à zéro gramme reste visible — c'est la marche, et
 * l'effacer donnerait un écran où « je fais tout à pied » se lit « je n'ai rien
 * fait ».
 */
describe('describeCarbonModes', () => {
  const totals = (
    mode: TransportMode,
    grams: number,
    distanceMeters = 4_000,
    tripsCount = 3,
  ): CarbonModeTotals => ({ mode, grams, distanceMeters, tripsCount });

  const breakdown: CarbonModeTotals[] = [
    totals(TransportMode.BUS, 5_900, 62_000, 7),
    totals(TransportMode.METRO, 3_800, 48_000, 5),
    totals(TransportMode.WALK, 0, 6_400, 9),
  ];

  it('turns each mode into a share of the period total', () => {
    const summary = describeCarbonModes(breakdown, 13_500)!;

    // 5 900 / 13 500 ≈ 44 %, la valeur de la planche.
    expect(summary.rows[0]?.sharePercent).toBe(44);
    expect(summary.rows[1]?.sharePercent).toBe(28);
  });

  it('keeps the order the API published rather than re-sorting', () => {
    const summary = describeCarbonModes(breakdown, 13_500)!;

    // La base a déjà trié par grammes décroissants : retrier ici ferait faire
    // deux fois le même travail, et divergerait le jour où l'ordre changerait.
    expect(summary.rows.map((row) => row.label)).toEqual(['Bus', 'Métro', 'Marche']);
  });

  it('keeps a zero-gram mode visible, with its distance', () => {
    const summary = describeCarbonModes(breakdown, 13_500)!;
    const walk = summary.rows[2]!;

    expect(walk.sharePercent).toBe(0);
    // C'est la distance qui porte l'information sur une ligne à zéro gramme :
    // 6,4 km parcourus à pied, ce n'est pas « rien ».
    expect(walk.distanceLabel).toBe('6,4 km');
    expect(walk.tripsLabel).toBe('9 trajets');
  });

  it('borrows the mode colours of the map rather than inventing its own', () => {
    const summary = describeCarbonModes(breakdown, 13_500)!;

    // Un bus bleu sur la carte et vert dans le bilan, ce serait deux langages
    // de couleur pour une seule application (C7 — WCAG 1.4.1).
    expect(summary.rows[0]?.color).toBe(MODE_TRACK_STYLES[TransportMode.BUS].color);
  });

  it('never divides by a null total', () => {
    const summary = describeCarbonModes([totals(TransportMode.WALK, 0, 3_000, 2)], 0)!;

    expect(summary.rows[0]?.sharePercent).toBe(0);
  });

  it('speaks the whole block in one sentence for assistive technologies', () => {
    const summary = describeCarbonModes(breakdown, 13_500)!;

    // Une pile de barres annoncée cellule par cellule donne une suite de
    // nombres sans verbe (C7 — WCAG 1.1.1).
    expect(summary.description).toContain('Bus, 5,9 kg CO₂ sur 62 km, 44 %');
    expect(summary.description).toContain('Marche, 0 g CO₂ sur 6,4 km, 0 %');
  });

  it('says nothing at all when the period holds no trip', () => {
    // L'écran affiche déjà son invite « votre bilan est encore vide » : un
    // cadre sans barre ne ferait que la répéter à vide.
    expect(describeCarbonModes([], 0)).toBeNull();
  });
});
