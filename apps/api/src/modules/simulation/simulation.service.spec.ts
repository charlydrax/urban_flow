import { BadRequestException } from '@nestjs/common';
import { SIMULATION_STEP_INTERVAL_MS, SIMULATION_TICKS } from '@urbanflow/shared';

import type { SimulateTripDto } from './dto/simulate-trip.dto';
import { SimulationService, interpolateAlong } from './simulation.service';

/**
 * Tests du service de simulation (UF-701).
 *
 * Ce qui compte ici n'est pas « le point bouge » mais les trois propriétés
 * dont dépend la démonstration :
 *
 * 1. la trace **part du départ et finit à la destination** — sinon le guidage
 *    ne franchit jamais son rayon d'arrivée et rien de ce qui en découle
 *    (UF-807) n'est observable ;
 * 2. les pas se répartissent sur le **temps** du trajet, donc proportionnellement
 *    aux durées des segments, et non à leurs longueurs ;
 * 3. un segment sans tracé ne déplace pas le point, mais consomme son temps.
 */

/** Un tracé rectiligne de `points` sommets, de `fromLng` à `toLng`, à latitude fixe. */
function line(fromLng: number, toLng: number, points = 2): [number, number][] {
  return Array.from({ length: points }, (_, index) => {
    const t = index / (points - 1);
    return [fromLng + (toLng - fromLng) * t, 45.75] as [number, number];
  });
}

const geometry = (coordinates: [number, number][]) =>
  ({ type: 'LineString', coordinates }) as const;

describe('SimulationService — UF-701', () => {
  const service = new SimulationService();

  const walkThenMetro: SimulateTripDto = {
    segments: [
      // 3 min de marche sur 0,01° …
      { durationMinutes: 3, geometry: geometry(line(4.85, 4.86)) },
      // … puis 9 min de métro sur 0,05° : trois fois plus de temps, donc
      // trois fois plus de pas, sur cinq fois plus de distance.
      { durationMinutes: 9, geometry: geometry(line(4.86, 4.91)) },
    ],
  };

  it('emits the announced number of ticks at the announced cadence', () => {
    const simulation = service.simulate(walkThenMetro);

    expect(simulation.ticks).toHaveLength(SIMULATION_TICKS);
    expect(simulation.stepIntervalMs).toBe(SIMULATION_STEP_INTERVAL_MS);
    expect(simulation.ticks.map((tick) => tick.index)).toEqual(
      Array.from({ length: SIMULATION_TICKS }, (_, index) => index),
    );
  });

  it('starts on the first point and ends exactly on the destination', () => {
    const { ticks } = service.simulate(walkThenMetro);

    expect(ticks[0].lng).toBeCloseTo(4.85, 6);
    // Exactement le dernier sommet : c'est ce qui fait franchir au guidage son
    // rayon d'arrivée (40 m). « Presque » ne déclencherait jamais l'arrivée.
    expect(ticks[ticks.length - 1].lng).toBeCloseTo(4.91, 6);
    expect(ticks[ticks.length - 1].segmentIndex).toBe(1);
  });

  it('splits the ticks over time, not over distance', () => {
    const { ticks } = service.simulate(walkThenMetro);

    const onWalk = ticks.filter((tick) => tick.segmentIndex === 0).length;
    const onMetro = ticks.filter((tick) => tick.segmentIndex === 1).length;

    // 3 min sur 12 : le quart des pas, alors que la marche ne pèse qu'un
    // sixième de la distance. C'est bien le temps qui découpe.
    expect(onWalk / SIMULATION_TICKS).toBeCloseTo(0.25, 1);
    expect(onWalk + onMetro).toBe(SIMULATION_TICKS);
  });

  it('advances elapsed time monotonically up to the trip duration', () => {
    const { ticks } = service.simulate(walkThenMetro);

    const elapsed = ticks.map((tick) => tick.elapsedSeconds);
    expect(elapsed[0]).toBe(0);
    expect(elapsed[elapsed.length - 1]).toBe(12 * 60);
    expect([...elapsed].sort((a, b) => a - b)).toEqual(elapsed);
  });

  it('holds the position still through a segment that carries no geometry', () => {
    // Marche, puis attente de bus (aucun tracé), puis bus.
    const { ticks } = service.simulate({
      segments: [
        { durationMinutes: 2, geometry: geometry(line(4.85, 4.86)) },
        { durationMinutes: 6 },
        { durationMinutes: 2, geometry: geometry(line(4.86, 4.87)) },
      ],
    });

    const waiting = ticks.filter((tick) => tick.segmentIndex === 1);
    expect(waiting.length).toBeGreaterThan(0);
    // Le temps s'écoule — les pas existent — mais le point reste au dernier
    // sommet connu : on attend son bus là où la marche s'est arrêtée.
    for (const tick of waiting) expect(tick.lng).toBeCloseTo(4.86, 6);
  });

  it('walks through a zero-length connection instead of getting stuck on it', () => {
    // Correspondance sur place : durée nulle, aucun tracé. Sans la règle
    // « le dernier segment dont la fenêtre a commencé », la trace s'y figerait.
    const { ticks } = service.simulate({
      segments: [
        { durationMinutes: 4, geometry: geometry(line(4.85, 4.86)) },
        { durationMinutes: 0 },
        { durationMinutes: 4, geometry: geometry(line(4.86, 4.88)) },
      ],
    });

    expect(ticks[ticks.length - 1].segmentIndex).toBe(2);
    expect(ticks[ticks.length - 1].lng).toBeCloseTo(4.88, 6);
  });

  it('refuses an itinerary that carries no geometry at all', () => {
    // Rien à montrer sur une carte : un refus franc vaut mieux qu'une
    // simulation immobile, que l'on prendrait pour une panne (C7).
    expect(() => service.simulate({ segments: [{ durationMinutes: 5 }] })).toThrow(
      BadRequestException,
    );
  });
});

describe('interpolateAlong — UF-701', () => {
  it('measures along cumulated length, not vertex index', () => {
    // Trois sommets très inégalement espacés : 0,01° puis 0,09°. À mi-longueur,
    // on doit être au milieu du **second** tronçon, pas sur le sommet du milieu.
    const path: [number, number][] = [
      [0, 45],
      [0.01, 45],
      [0.1, 45],
    ];

    expect(interpolateAlong(path, 0.5)[0]).toBeCloseTo(0.05, 6);
  });

  it('clamps to the endpoints', () => {
    const path = line(4.85, 4.9);

    expect(interpolateAlong(path, -1)).toEqual(path[0]);
    expect(interpolateAlong(path, 2)).toEqual(path[path.length - 1]);
  });

  it('survives a path whose vertices are all identical', () => {
    // Division par zéro évitée : une polyligne de longueur nulle n'a pas de
    // proportion à établir.
    const path: [number, number][] = [
      [4.85, 45.75],
      [4.85, 45.75],
    ];

    expect(interpolateAlong(path, 0.5)).toEqual([4.85, 45.75]);
  });
});
