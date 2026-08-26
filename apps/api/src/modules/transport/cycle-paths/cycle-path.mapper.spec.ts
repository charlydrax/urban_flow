import { CycleFacilityType } from '@urbanflow/shared';

import { parseCyclePathGeometry, toCycleFacilityType } from './cycle-path.mapper';

/**
 * Tests de la frontière du connecteur pistes cyclables (UF-304).
 *
 * Ce fichier fige deux garanties :
 *  1. les libellés du producteur sont projetés sur le vocabulaire interne (C9),
 *     y compris quand la casse ou les accents varient — un jeu de données de
 *     voirie n'a aucune raison d'être stable là-dessus ;
 *  2. un tracé illisible **lève** au lieu de traverser l'API : dessiner une
 *     piste au mauvais endroit est pire que ne rien dessiner.
 */
describe('cycle-path.mapper', () => {
  describe('toCycleFacilityType', () => {
    it.each([
      ['Piste Cyclable', CycleFacilityType.CYCLE_TRACK],
      ['Bande Cyclable', CycleFacilityType.CYCLE_LANE],
      ['Voie verte', CycleFacilityType.GREENWAY],
      ['Double sens cyclable', CycleFacilityType.SHARED_STREET],
      ['Vélorue', CycleFacilityType.SHARED_STREET],
      ['Chaussée à voie centrale banalisée (CVCB)', CycleFacilityType.SHARED_STREET],
      ['Couloir bus vélo élargi', CycleFacilityType.BUS_LANE],
      ['Couloir bus vélo non élargi', CycleFacilityType.BUS_LANE],
      ['Goulotte ou rampe', CycleFacilityType.CROSSING],
    ])('maps the producer label %s to %s', (label, expected) => {
      expect(toCycleFacilityType(label)).toBe(expected);
    });

    it('ignores case, accents and stray whitespace', () => {
      // Les trois écritures se rencontrent réellement dans les exports de voirie.
      expect(toCycleFacilityType('PISTE CYCLABLE')).toBe(CycleFacilityType.CYCLE_TRACK);
      expect(toCycleFacilityType('  Voie  Verte ')).toBe(CycleFacilityType.GREENWAY);
      expect(toCycleFacilityType('Couloir bus velo elargi')).toBe(CycleFacilityType.BUS_LANE);
    });

    it('falls back to OTHER instead of dropping an unknown facility', () => {
      // Un type inconnu n'invalide pas l'aménagement : le tronçon existe et
      // reste cyclable. C'est la différence avec un mode de transport faux,
      // qui, lui, fausserait le calcul carbone (cf. otp.mapper).
      expect(toCycleFacilityType('Aménagement expérimental 2027')).toBe(CycleFacilityType.OTHER);
      expect(toCycleFacilityType('')).toBe(CycleFacilityType.OTHER);
    });
  });

  describe('parseCyclePathGeometry', () => {
    const geojson = JSON.stringify({
      type: 'MultiLineString',
      coordinates: [
        [
          [4.8591, 45.7604],
          [4.8598, 45.761],
        ],
      ],
    });

    it('turns the PostGIS text output into a GeoJSON object (C9)', () => {
      const geometry = parseCyclePathGeometry(geojson, '3452');

      expect(geometry.type).toBe('MultiLineString');
      expect(geometry.coordinates[0][0]).toEqual([4.8591, 45.7604]);
    });

    it('rejects an unreadable geometry rather than passing it through', () => {
      expect(() => parseCyclePathGeometry('{not json', '3452')).toThrow(/3452/);
    });

    it('rejects a geometry of another type', () => {
      // Une LineString ici signifierait que la colonne ne contient pas ce
      // qu'elle déclare — un signal d'alerte, pas une donnée à accommoder.
      const lineString = JSON.stringify({
        type: 'LineString',
        coordinates: [
          [4.8591, 45.7604],
          [4.8598, 45.761],
        ],
      });

      expect(() => parseCyclePathGeometry(lineString, '3452')).toThrow(/MultiLineString/);
    });

    it('rejects coordinates that are not numeric pairs', () => {
      const broken = JSON.stringify({
        type: 'MultiLineString',
        coordinates: [[['4.8591', '45.7604']]],
      });

      expect(() => parseCyclePathGeometry(broken, '3452')).toThrow();
    });
  });
});
