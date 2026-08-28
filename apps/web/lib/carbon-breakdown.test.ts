import { TransportMode, type CarbonFootprint, type Itinerary } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import { describeCarbonBreakdown } from './carbon-breakdown';
import { MODE_TRACK_STYLES } from './route-map-layers';

/**
 * Lecture du détail carbone publié par l'API (UF-501).
 *
 * Ce que ces tests protègent avant tout : **le client ne recalcule rien**. Les
 * grammes affichés sont ceux du serveur, y compris quand ils ne collent pas à
 * ce qu'une multiplication locale donnerait — un barème qui évolue côté API ne
 * doit pas demander un déploiement du front pour être affiché juste.
 */
describe('describeCarbonBreakdown', () => {
  /** Itinéraire d'essai : 400 m de marche puis 4 km de bus C3. */
  const footprint: CarbonFootprint = {
    totalGrams: 380,
    segments: [
      {
        mode: TransportMode.WALK,
        distanceMeters: 400,
        factorGramsPerKm: 0,
        grams: 0,
      },
      {
        mode: TransportMode.BUS,
        distanceMeters: 4000,
        factorGramsPerKm: 95,
        grams: 380,
      },
    ],
    carEquivalentGrams: 959,
    avoidedGrams: 579,
  };

  const itinerary = (overrides: Partial<Itinerary> = {}): Itinerary => ({
    id: 'itin-1',
    summary: 'Marche + Bus C3',
    durationMinutes: 22,
    distanceMeters: 4400,
    carbonGrams: 380,
    carbon: footprint,
    accessible: true,
    segments: [
      {
        mode: TransportMode.WALK,
        from: 'Part-Dieu',
        to: 'Saxe',
        durationMinutes: 5,
        distanceMeters: 400,
        carbonGrams: 0,
      },
      {
        mode: TransportMode.BUS,
        from: 'Saxe',
        to: 'Bellecour',
        durationMinutes: 17,
        distanceMeters: 4000,
        carbonGrams: 380,
        line: 'C3',
      },
    ],
    ...overrides,
  });

  it('turns each published line into a readable row', () => {
    const breakdown = describeCarbonBreakdown(itinerary());

    expect(breakdown?.rows).toHaveLength(2);
    const [walk, bus] = breakdown?.rows ?? [];

    // Les libellés manquants du détail carbone sont repris du segment de même
    // rang : c'est tout l'objet de l'appariement positionnel.
    expect(walk?.route).toBe('Part-Dieu → Saxe');
    expect(bus?.label).toBe('Bus C3');
    expect(bus?.route).toBe('Saxe → Bellecour');

    // Le facteur est affiché tel quel : c'est lui qui rend la ligne vérifiable.
    expect(bus?.factorLabel).toBe('95 g/km');
    expect(bus?.carbonLabel).toBe('380 g CO₂');
  });

  it('reuses the mode colour of the map track, so both read as one', () => {
    const breakdown = describeCarbonBreakdown(itinerary());

    expect(breakdown?.rows[1]?.color).toBe(MODE_TRACK_STYLES[TransportMode.BUS].color);
  });

  it('formats distances in metres below the kilometre', () => {
    const breakdown = describeCarbonBreakdown(itinerary());

    expect(breakdown?.rows[0]?.distanceLabel).toBe('400 m');
    expect(breakdown?.rows[1]?.distanceLabel).toBe('4 km');
  });

  it('sizes each bar on its share of the total', () => {
    const breakdown = describeCarbonBreakdown(itinerary());

    expect(breakdown?.rows[0]?.sharePercent).toBe(0);
    expect(breakdown?.rows[1]?.sharePercent).toBe(100);
  });

  it('never divides by a zero total', () => {
    // Un itinéraire tout-marche est à 0 g : il n'a pas de répartition, et en
    // calculer une produirait un NaN dans un attribut de style.
    const soft = describeCarbonBreakdown(
      itinerary({
        carbon: {
          totalGrams: 0,
          segments: [
            { mode: TransportMode.WALK, distanceMeters: 900, factorGramsPerKm: 0, grams: 0 },
          ],
          carEquivalentGrams: 196,
          avoidedGrams: 196,
        },
      }),
    );

    expect(soft?.rows[0]?.sharePercent).toBe(0);
    expect(soft?.totalLabel).toBe('0 g CO₂');
  });

  it('states what the same trip would have cost by car', () => {
    const breakdown = describeCarbonBreakdown(itinerary());

    expect(breakdown?.comparison?.carLabel).toBe('959 g CO₂');
    expect(breakdown?.comparison?.avoidedLabel).toBe('579 g CO₂');
    expect(breakdown?.comparison?.avoidedPercent).toBe(60);
  });

  it('says the whole table in one sentence for screen readers', () => {
    const breakdown = describeCarbonBreakdown(itinerary());

    // Un tableau de barres énoncé cellule par cellule ne dit rien : c'est cette
    // phrase que le lecteur d'écran annonce (C7 — WCAG 1.1.1).
    expect(breakdown?.description).toContain('380 g CO₂ au total');
    expect(breakdown?.description).toContain('Bus C3, 4 km à 95 g/km');
    expect(breakdown?.description).toContain('voiture');
  });

  it('publishes the grams it was given, without recomputing them', () => {
    // Barème hypothétique venu du serveur : le front l'affiche sans le corriger.
    const breakdown = describeCarbonBreakdown(
      itinerary({
        carbon: {
          ...footprint,
          segments: [
            footprint.segments[0]!,
            { ...footprint.segments[1]!, factorGramsPerKm: 40, grams: 160 },
          ],
          totalGrams: 160,
        },
      }),
    );

    expect(breakdown?.rows[1]?.carbonLabel).toBe('160 g CO₂');
    expect(breakdown?.totalLabel).toBe('160 g CO₂');
  });

  it('says nothing at all when the itinerary carries no breakdown', () => {
    // Réponse d'un cache antérieur au ticket : l'écran se tait plutôt que
    // d'afficher un cadre vide ou d'inventer des chiffres (C10).
    expect(describeCarbonBreakdown(itinerary({ carbon: undefined }))).toBeNull();
  });
});
