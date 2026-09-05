import { act, renderHook } from '@testing-library/react';
import type { Itinerary, RouteSegment, TripSimulation } from '@urbanflow/shared';
import { TransportMode } from '@urbanflow/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import type { UserLocationState } from '../planner/use-user-location';
import { useNavigation } from './use-navigation';

/**
 * Abonnement GPS bouchonné — et **compté**.
 *
 * Le compteur est la moitié de l'intérêt du fichier : la recette d'UF-701 dit
 * que la géolocalisation n'est plus obligatoire pour démontrer un trajet, et la
 * seule façon de le prouver est de vérifier qu'aucun abonnement n'est ouvert.
 */
let watchCount = 0;

vi.mock('../../lib/geolocation', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/geolocation')>('../../lib/geolocation');
  return {
    ...actual,
    watchUserPosition: () => {
      watchCount += 1;
      return () => undefined;
    },
  };
});

const simulateTrip = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ...actual,
    apiClient: { simulateTrip: (payload: unknown) => simulateTrip(payload) },
  };
});

/**
 * UF-701 — le mode simulation, vu du hook.
 *
 * Ce qui se joue ici est le **branchement**, pas le calcul : la machine à états
 * et le compteur carbone sont déjà couverts, sans navigateur, par
 * `lib/navigation-machine.test.ts` et `lib/travelled-carbon.test.ts`. Restent
 * les quatre choses qu'on ne peut vérifier qu'en montant le hook :
 *
 *  1. la trace est **rejouée à la cadence annoncée**, un pas par intervalle ;
 *  2. elle mène à l'arrivée, donc au comptage du trajet (UF-807) — c'est la
 *     raison d'être du ticket : sans elle, l'empreinte d'un trajet n'est jamais
 *     comptabilisée par qui ne se déplace pas ;
 *  3. **aucun abonnement GPS n'est ouvert** — la géolocalisation réelle reste
 *     une option terrain, elle n'est plus un péage (C5/C8) ;
 *  4. un `403` est **affiché**, pas contourné : le client ne décide pas qui est
 *     exploitant (C4).
 */
describe('Mode simulation de trajet (UF-701)', () => {
  const segment = (): RouteSegment =>
    ({
      mode: TransportMode.WALK,
      distanceMeters: 1_000,
      durationMinutes: 12,
      from: 'Départ',
      to: 'Arrivée',
      carbonGrams: 0,
      geometry: {
        type: 'LineString',
        coordinates: [
          [4.85, 45.75],
          [4.85, 45.759],
        ],
      },
    }) as unknown as RouteSegment;

  const itinerary = (): Itinerary =>
    ({
      id: 'itinerary-1',
      summary: 'Marche',
      durationMinutes: 12,
      distanceMeters: 1_000,
      carbonGrams: 0,
      accessible: false,
      segments: [segment()],
    }) as unknown as Itinerary;

  /** Trace de trois pas : départ, milieu, destination. */
  const track = (): TripSimulation => ({
    stepIntervalMs: 2000,
    ticks: [
      { index: 0, lat: 45.75, lng: 4.85, segmentIndex: 0, elapsedSeconds: 0 },
      { index: 1, lat: 45.7545, lng: 4.85, segmentIndex: 0, elapsedSeconds: 360 },
      { index: 2, lat: 45.759, lng: 4.85, segmentIndex: 0, elapsedSeconds: 720 },
    ],
  });

  /**
   * Position **jamais consentie** : c'est le cas qui compte ici. La simulation
   * doit fonctionner pour quelqu'un qui n'a pas partagé sa position — c'est
   * précisément le poste fixe d'une soutenance.
   */
  const notLocated = (): UserLocationState =>
    ({ status: 'idle', position: null, requestLocation: vi.fn() }) as unknown as UserLocationState;

  beforeEach(() => {
    watchCount = 0;
    simulateTrip.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays the track, reaches the destination and reports the trip', async () => {
    simulateTrip.mockResolvedValue(track());
    const onArrival = vi.fn();
    const { result } = renderHook(() => useNavigation(notLocated(), onArrival));

    await act(async () => {
      result.current.simulate(itinerary());
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.state.source).toBe('simulation');
    expect(result.current.state.phase).toBe('guiding');
    // Démarrer n'est pas arriver : aucune position n'a encore été rejouée.
    expect(onArrival).not.toHaveBeenCalled();

    // Deux pas : on est en chemin, pas au bout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(result.current.state.phase).toBe('guiding');
    expect(onArrival).not.toHaveBeenCalled();

    // Troisième pas : la trace touche le dernier point du tracé.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.state.phase).toBe('arrived');
    // C'est tout l'objet du ticket : un trajet démontré est un trajet compté.
    expect(onArrival).toHaveBeenCalledTimes(1);
  });

  it('never opens the GPS subscription for a simulated session (C5/C8)', async () => {
    simulateTrip.mockResolvedValue(track());
    const { result } = renderHook(() => useNavigation(notLocated()));

    // Deux temps, comme dans le test précédent : la trace doit d'abord
    // arriver (le minuteur ne peut pas exister avant elle), et seulement
    // ensuite être rejouée.
    await act(async () => {
      result.current.simulate(itinerary());
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(result.current.state.phase).toBe('arrived');
    // La géolocalisation réelle reste l'option terrain — elle n'est plus le
    // péage d'entrée d'une démonstration.
    expect(watchCount).toBe(0);
  });

  it('sends only the duration and geometry of each segment', async () => {
    simulateTrip.mockResolvedValue(track());
    const { result } = renderHook(() => useNavigation(notLocated()));

    await act(async () => {
      result.current.simulate(itinerary());
      await vi.advanceTimersByTimeAsync(0);
    });

    // Ni empreinte ni mode : le serveur n'a pas à recevoir ce dont il n'a pas
    // besoin, et surtout pas des grammes venus du navigateur (UF-505).
    expect(simulateTrip).toHaveBeenCalledWith({
      segments: [{ durationMinutes: 12, geometry: itinerary().segments[0].geometry }],
    });
  });

  it('surfaces a 403 instead of pretending the account may simulate (C4)', async () => {
    simulateTrip.mockRejectedValue(new ApiError(403, 'Insufficient permissions'));
    const { result } = renderHook(() => useNavigation(notLocated()));

    await act(async () => {
      result.current.simulate(itinerary());
      // Deux tours de micro-tâches : `.catch` puis `.finally`.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.simulationError).toMatch(/comptes exploitants/);
    // Aucune session ouverte : le refus n'est pas contourné côté client.
    expect(result.current.state.phase).toBe('idle');
    expect(result.current.preparingSimulation).toBe(false);
  });

  it('distinguishes a server failure from a refusal', async () => {
    simulateTrip.mockRejectedValue(new ApiError(500, 'boom'));
    const { result } = renderHook(() => useNavigation(notLocated()));

    await act(async () => {
      result.current.simulate(itinerary());
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });

    // « Réessayez » plutôt que « réservé aux exploitants » : dire la mauvaise
    // cause enverrait chercher un droit là où il manque un serveur.
    expect(result.current.simulationError).toMatch(/n’a pas pu démarrer/);
  });

  it('drops the simulation when a real guidance session starts', async () => {
    simulateTrip.mockResolvedValue(track());
    const { result } = renderHook(() =>
      useNavigation({
        status: 'ready',
        position: { lat: 45.75, lng: 4.85, accuracyMeters: 10 },
        requestLocation: vi.fn(),
      } as unknown as UserLocationState),
    );

    await act(async () => {
      result.current.simulate(itinerary());
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.state.source).toBe('simulation');

    act(() => result.current.start(itinerary()));
    expect(result.current.state.source).toBe('gps');

    // Le minuteur de la trace est coupé : les deux sources ne doivent jamais
    // alimenter la même machine.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.state.phase).toBe('guiding');
  });
});
