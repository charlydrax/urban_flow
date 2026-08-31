import { TransportMode, type CarbonTrip } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import { buildCarbonTripsCsv, carbonExportFilename, describeCarbonTrips } from './carbon-trips';

/**
 * Tableau « Détail par trajet » et export (UF-805).
 *
 * Deux choses s'y jouent, et la seconde est la moins visible :
 *
 * - un trajet **antérieur** à ce ticket n'a pas de ventilation par mode, donc
 *   pas de distance connue. « 0 km » serait faux là où « inconnue » est exact ;
 * - un libellé de lieu vient de la saisie de l'usager, et se retrouve tel quel
 *   dans un fichier qu'un tableur va **évaluer**. C'est l'injection de formule
 *   CSV (OWASP A03, C4), et elle s'exploite à l'ouverture du fichier — donc
 *   souvent chez quelqu'un d'autre que celui qui l'a produit.
 */
describe('carbon trips', () => {
  const trip = (overrides: Partial<CarbonTrip> = {}): CarbonTrip => ({
    id: 'trip-1',
    createdAt: '2026-08-27T08:12:00.000Z',
    fromLabel: 'République',
    toLabel: 'Bellecour',
    selectedSummary: 'Marche + Métro B',
    modes: [
      { mode: TransportMode.METRO, distanceMeters: 5_100, grams: 204, tripsCount: 1 },
      { mode: TransportMode.WALK, distanceMeters: 600, grams: 0, tripsCount: 1 },
    ],
    distanceMeters: 5_700,
    emittedGrams: 204,
    carEquivalentGrams: 1_112,
    avoidedGrams: 908,
    ...overrides,
  });

  const now = new Date('2026-08-28T12:00:00.000Z');

  describe('describeCarbonTrips', () => {
    it('lays out a trip as the table shows it', () => {
      const [row] = describeCarbonTrips([trip()], now);

      expect(row?.routeLabel).toBe('République → Bellecour');
      expect(row?.summaryLabel).toBe('Marche + Métro B');
      expect(row?.distanceLabel).toBe('5,7 km');
      expect(row?.carbonLabel).toBe('204 g CO₂');
      expect(row?.avoidedLabel).toBe('908 g CO₂');
      expect(row?.modes.map((mode) => mode.label)).toEqual(['Métro', 'Marche']);
    });

    it('leaves a pre-UF-805 trip without a distance rather than showing zero', () => {
      const [row] = describeCarbonTrips([trip({ modes: [], distanceMeters: 0 })], now);

      // `null` remonte jusqu'au composant, qui affiche « — » : un trajet de
      // zéro kilomètre n'existe pas, une distance inconnue si.
      expect(row?.distanceLabel).toBeNull();
    });

    it('falls back on the modes when the trip carries no summary', () => {
      const [row] = describeCarbonTrips([trip({ selectedSummary: null })], now);

      expect(row?.summaryLabel).toBe('Métro + Marche');
    });

    it('speaks each row as a sentence for assistive technologies', () => {
      const [row] = describeCarbonTrips([trip()], now);

      expect(row?.description).toContain('République → Bellecour');
      expect(row?.description).toContain('204 g CO₂ émis');
      expect(row?.description).toContain('908 g CO₂ évités');
    });
  });

  describe('buildCarbonTripsCsv', () => {
    it('opens with a UTF-8 BOM so a French Excel reads the accents', () => {
      const csv = buildCarbonTripsCsv([trip()]);

      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain('République');
    });

    it('separates cells with a semicolon, the French spreadsheet convention', () => {
      const csv = buildCarbonTripsCsv([trip()]);
      const [header] = csv.slice(1).split('\r\n');

      expect(header).toBe(
        '"Date";"Départ";"Arrivée";"Option retenue";"Modes";' +
          '"Distance (km)";"CO2 émis (g)";"CO2 évité vs voiture (g)"',
      );
    });

    it('writes an absolute date, not a relative one', () => {
      const csv = buildCarbonTripsCsv([trip()]);

      // « hier » n'a aucun sens dans un fichier ouvert trois semaines plus tard.
      expect(csv).toContain('"2026-08-27"');
      // L'heure exacte d'un déplacement est la donnée la plus ré-identifiante
      // du lot : elle ne sort pas (C8).
      expect(csv).not.toContain('08:12');
    });

    it('neutralises a place label that a spreadsheet would run as a formula (C4)', () => {
      const csv = buildCarbonTripsCsv([trip({ fromLabel: '=1+1' })]);

      // Préfixe apostrophe, la neutralisation recommandée par l'OWASP : le
      // tableur affiche le texte au lieu de l'évaluer.
      expect(csv).toContain(`"'=1+1"`);
    });

    it('escapes a quote inside a label instead of breaking the row', () => {
      const csv = buildCarbonTripsCsv([trip({ toLabel: 'Place "Bellecour"' })]);

      expect(csv).toContain('"Place ""Bellecour"""');
    });

    it('leaves the distance cell empty when it is unknown', () => {
      const csv = buildCarbonTripsCsv([trip({ modes: [], distanceMeters: 0 })]);
      const [, row] = csv.slice(1).split('\r\n');

      // Une cellule vide se relit comme « pas de donnée » ; un zéro se
      // moyennerait avec les autres lignes et fausserait un calcul aval.
      expect(row).toContain(';"";');
    });

    it('exports one row per trip, plus the header', () => {
      const csv = buildCarbonTripsCsv([trip({ id: 'a' }), trip({ id: 'b' })]);

      expect(csv.trimEnd().split('\r\n')).toHaveLength(3);
    });
  });

  describe('carbonExportFilename', () => {
    it('dates the file so two exports do not overwrite each other', () => {
      expect(carbonExportFilename(30, now)).toBe('urbanflow-impact-30j-2026-08-28.csv');
    });
  });
});
