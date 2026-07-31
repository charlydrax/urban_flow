import { describe, expect, it } from 'vitest';

import { formatSearchDate } from './format-search-date';

/**
 * Fige le format des dates de la liste des trajets récents (UF-204).
 * Les instants sont construits en heure **locale** (`new Date(y, m, d, h, min)`)
 * pour que le test ne dépende pas du fuseau de la machine qui l'exécute.
 */
describe('formatSearchDate', () => {
  /** 31 juillet 2026, 18:30 — instant de référence des cas ci-dessous. */
  const now = new Date(2026, 6, 31, 18, 30);

  it('situates a search made the same day by its time', () => {
    expect(formatSearchDate(new Date(2026, 6, 31, 9, 12).toISOString(), now)).toBe(
      'aujourd’hui, 09:12',
    );
  });

  it('names yesterday rather than counting hours', () => {
    expect(formatSearchDate(new Date(2026, 6, 30, 22, 5).toISOString(), now)).toBe('hier, 22:05');
  });

  it('drops the time once the day stops being recognisable', () => {
    // Au-delà d'hier, l'heure n'aide plus à reconnaître un trajet.
    expect(formatSearchDate(new Date(2026, 6, 24, 8, 0).toISOString(), now)).toBe('24 juil.');
  });

  it('counts calendar days, not elapsed hours', () => {
    // 23h05 la veille pour 00h30 : moins de 2 h d'écart, mais bien « hier ».
    expect(
      formatSearchDate(new Date(2026, 6, 30, 23, 5).toISOString(), new Date(2026, 6, 31, 0, 30)),
    ).toBe('hier, 23:05');
  });

  it('treats a future timestamp as today rather than showing a negative delay', () => {
    // Horloge client en avance : mieux vaut un libellé plat qu'un « il y a -1 jour ».
    expect(formatSearchDate(new Date(2026, 7, 1, 10, 0).toISOString(), now)).toBe(
      'aujourd’hui, 10:00',
    );
  });

  it('returns an empty label instead of "Invalid Date"', () => {
    expect(formatSearchDate('pas une date', now)).toBe('');
  });
});
