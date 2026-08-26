import { distanceMeters } from './distance';

/**
 * La distance est ce qui décide de la sélection **et** du tri des stations :
 * une erreur ici ne se verrait pas dans la réponse, elle donnerait juste de
 * mauvaises stations. D'où des références mesurables.
 */

/** Deux points lyonnais dont l'écart est vérifiable sur une carte. */
const PART_DIEU = { lat: 45.760515, lng: 4.859057 };
const BELLECOUR = { lat: 45.757813, lng: 4.832011 };

describe('distanceMeters', () => {
  it('mesure une distance urbaine connue à quelques mètres près', () => {
    // Part-Dieu → Bellecour : environ 2,1 km à vol d'oiseau.
    expect(distanceMeters(PART_DIEU, BELLECOUR)).toBeGreaterThan(2050);
    expect(distanceMeters(PART_DIEU, BELLECOUR)).toBeLessThan(2200);
  });

  it('rend zéro pour un point sur lui-même', () => {
    expect(distanceMeters(PART_DIEU, PART_DIEU)).toBe(0);
  });

  it('est symétrique : l’ordre des points ne change rien', () => {
    expect(distanceMeters(PART_DIEU, BELLECOUR)).toBe(distanceMeters(BELLECOUR, PART_DIEU));
  });

  it('mesure correctement un écart en latitude (un degré ≈ 111 km)', () => {
    const north = { lat: PART_DIEU.lat + 1, lng: PART_DIEU.lng };

    expect(distanceMeters(PART_DIEU, north)).toBeGreaterThan(111_000);
    expect(distanceMeters(PART_DIEU, north)).toBeLessThan(111_500);
  });

  it('rend un entier — la réponse d’API ne promet pas le centimètre', () => {
    expect(Number.isInteger(distanceMeters(PART_DIEU, BELLECOUR))).toBe(true);
  });
});
