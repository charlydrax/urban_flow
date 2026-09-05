import { TransportMode, type Itinerary, type RouteSegment } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import type { RouteProgress } from './route-progress';
import { travelledCarbonGrams } from './travelled-carbon';

/**
 * Tests du compteur d'empreinte parcourue (UF-701).
 *
 * La propriété qui compte n'est pas « le nombre monte » mais **d'où il sort** :
 * les grammes sont ceux que le Service Carbone a publiés sur chaque segment, et
 * jamais un barème refait dans le navigateur. Le seul calcul fait ici est une
 * répartition au prorata de la distance parcourue sur le segment en cours.
 */

function segment(mode: TransportMode, carbonGrams: number, distanceMeters: number): RouteSegment {
  return { mode, from: 'A', to: 'B', durationMinutes: 10, distanceMeters, carbonGrams };
}

/** Marche gratuite de 500 m, puis bus à 240 g sur 4 km. */
const TRIP: Itinerary = {
  id: 'itin-1',
  summary: 'Marche + Bus',
  durationMinutes: 20,
  distanceMeters: 4500,
  carbonGrams: 240,
  accessible: false,
  segments: [segment(TransportMode.WALK, 0, 500), segment(TransportMode.BUS, 240, 4000)],
};

/** Progression minimale : seuls l'index, le segment et le reste sont lus. */
function progressOn(segmentIndex: number, segmentRemainingMeters: number): RouteProgress {
  return {
    segmentIndex,
    segment: TRIP.segments[segmentIndex],
    snapped: { lat: 45.76, lng: 4.85 },
    segmentRemainingMeters,
    segmentRemainingMinutes: 0,
    totalRemainingMeters: segmentRemainingMeters,
    totalRemainingMinutes: 0,
    completedRatio: 0,
    offRouteMeters: 0,
    offRoute: false,
    arrived: false,
  };
}

describe('travelledCarbonGrams — UF-701', () => {
  it('vaut zéro tant qu’aucune position n’est arrivée', () => {
    expect(travelledCarbonGrams(TRIP, null)).toBe(0);
  });

  it('ne compte rien pour un segment gratuit, même terminé', () => {
    // Toute la marche faite, le bus pas commencé : l'écran doit afficher 0 g,
    // pas « bientôt 240 ».
    expect(travelledCarbonGrams(TRIP, progressOn(0, 0))).toBe(0);
  });

  it('compte les segments franchis en entier', () => {
    // Bus terminé : les 240 g du bus, plus les 0 g de la marche.
    expect(travelledCarbonGrams(TRIP, progressOn(1, 0))).toBe(240);
  });

  it('répartit le segment en cours au prorata de la distance parcourue', () => {
    // Trois quarts du bus faits : trois quarts de ses grammes. Aucune donnée
    // n'est inventée — le serveur ne publie pas de profil d'émission instantané.
    expect(travelledCarbonGrams(TRIP, progressOn(1, 1000))).toBe(180);
  });

  it('ne compte pas les segments à venir', () => {
    // C'est tout l'intérêt du compteur : il dit ce qui a été émis, pas ce que
    // le trajet coûtera. Ce dernier chiffre est déjà sur la carte de résultat.
    expect(travelledCarbonGrams(TRIP, progressOn(1, 4000))).toBeLessThan(TRIP.carbonGrams);
  });

  it('survit à un segment de distance nulle', () => {
    // Correspondance sur place : pas de division par zéro, et rien à compter.
    const zero: Itinerary = {
      ...TRIP,
      segments: [segment(TransportMode.WALK, 0, 0), segment(TransportMode.BUS, 240, 4000)],
    };

    expect(
      travelledCarbonGrams(zero, {
        ...progressOn(0, 0),
        segment: zero.segments[0],
      }),
    ).toBe(0);
  });
});
