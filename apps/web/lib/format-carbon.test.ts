import { describe, expect, it } from 'vitest';

import { formatCarbon } from './format-carbon';

/** Test smoke : vérifie la chaîne Vitest et fige le format d'affichage du CO₂. */
describe('formatCarbon', () => {
  it('formats small footprints in grams', () => {
    expect(formatCarbon(0)).toBe('0 g CO₂');
    expect(formatCarbon(240)).toBe('240 g CO₂');
  });

  it('formats large footprints in kilograms (French locale)', () => {
    expect(formatCarbon(1240)).toBe('1,2 kg CO₂');
  });
});
