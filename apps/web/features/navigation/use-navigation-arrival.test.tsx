import { act, renderHook } from '@testing-library/react';
import type { Itinerary, RouteSegment } from '@urbanflow/shared';
import { TransportMode } from '@urbanflow/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserLocationState } from '../planner/use-user-location';
import { useNavigation } from './use-navigation';

/** Abonnement GPS bouchonné : le test pousse les positions à la main. */
let emitPosition:
  | ((position: { lat: number; lng: number; accuracyMeters: number }) => void)
  | null = null;

vi.mock('../../lib/geolocation', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/geolocation')>('../../lib/geolocation');
  return {
    ...actual,
    watchUserPosition: ({ onPosition }: { onPosition: (position: unknown) => void }) => {
      emitPosition = onPosition as typeof emitPosition;
      return () => {
        emitPosition = null;
      };
    },
  };
});

/**
 * UF-807 — recette 2 : « un itinéraire mené jusqu'à l'arrivée est compté comme
 * réalisé ».
 *
 * Le test porte sur le hook et non sur l'écran parce que ce qui est en jeu est
 * un **événement**, pas un affichage : la question est de savoir qui prévient
 * le serveur, quand, et combien de fois. Trois choses s'y jouent, et ce sont
 * exactement les trois manières de se tromper ici :
 *
 *  1. l'arrivée est annoncée — sans quoi aucun trajet n'entrerait jamais dans
 *     le bilan, et le ticket aurait déplacé le défaut au lieu de le corriger ;
 *  2. elle l'est **une seule fois** — trois pas de plus dans le hall d'arrivée
 *     ne doivent pas ajouter un second trajet ;
 *  3. elle ne l'est **pas** avant l'arrivée — le simple fait de démarrer un
 *     guidage n'est pas un déplacement accompli.
 *
 * Le fichier est en `.tsx` pour tomber dans la suite jsdom (`vitest.config.ts`) :
 * `renderHook` a besoin d'un DOM, que la suite unitaire en `node` n'a pas.
 */
describe('Arrivée du guidage et comptage carbone (UF-807)', () => {
  /** Un tracé droit de 1 000 m environ, du départ à l'arrivée. */
  const segment = (): RouteSegment =>
    ({
      mode: TransportMode.WALK,
      distanceMeters: 1_000,
      durationMinutes: 12,
      from: { label: 'Départ', lat: 45.75, lng: 4.85 },
      to: { label: 'Arrivée', lat: 45.759, lng: 4.85 },
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
      departureTime: null,
      arrivalTime: null,
      segments: [segment()],
      carbon: { totalGrams: 0, segments: [], carEquivalentGrams: 180, avoidedGrams: 180 },
    }) as unknown as Itinerary;

  /** Position déjà consentie : le guidage démarre sans passer par le portail. */
  const located = (): UserLocationState =>
    ({
      status: 'ready',
      position: { lat: 45.75, lng: 4.85, accuracyMeters: 10 },
      requestLocation: vi.fn(),
    }) as unknown as UserLocationState;

  beforeEach(() => {
    emitPosition = null;
  });

  it('announces the arrival exactly once, and only once the destination is reached', () => {
    const onArrival = vi.fn();
    const { result } = renderHook(() => useNavigation(located(), onArrival));

    act(() => result.current.start(itinerary()));

    // Guidage lancé, mais rien de parcouru : démarrer n'est pas arriver.
    expect(onArrival).not.toHaveBeenCalled();

    // Une position à mi-parcours ne conclut rien non plus.
    act(() => emitPosition?.({ lat: 45.7545, lng: 4.85, accuracyMeters: 10 }));
    expect(onArrival).not.toHaveBeenCalled();

    // Position sur le point d'arrivée : la machine passe en `arrived`.
    act(() => emitPosition?.({ lat: 45.759, lng: 4.85, accuracyMeters: 10 }));
    expect(result.current.state.phase).toBe('arrived');
    expect(onArrival).toHaveBeenCalledTimes(1);

    // Recette : c'est l'itinéraire **suivi** qui est remonté, celui sur lequel
    // le guidage a démarré — c'est lui qu'il faut valoriser, pas l'option
    // cochée dans la liste au moment du clic.
    expect(onArrival.mock.calls[0][0]).toMatchObject({ id: 'itinerary-1', summary: 'Marche' });
  });

  it('does not report a second trip when the user keeps moving after arriving', () => {
    const onArrival = vi.fn();
    const { result } = renderHook(() => useNavigation(located(), onArrival));

    act(() => result.current.start(itinerary()));
    act(() => emitPosition?.({ lat: 45.759, lng: 4.85, accuracyMeters: 10 }));
    expect(onArrival).toHaveBeenCalledTimes(1);

    // Trois pas dans le hall. `arrived` est terminal : rien ne se rejoue.
    act(() => emitPosition?.({ lat: 45.7591, lng: 4.8501, accuracyMeters: 10 }));
    act(() => emitPosition?.({ lat: 45.7592, lng: 4.8502, accuracyMeters: 10 }));

    expect(onArrival).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe('arrived');
  });

  it('reports nothing when the guidance is stopped before the destination', () => {
    const onArrival = vi.fn();
    const { result } = renderHook(() => useNavigation(located(), onArrival));

    act(() => result.current.start(itinerary()));
    act(() => emitPosition?.({ lat: 45.7545, lng: 4.85, accuracyMeters: 10 }));
    act(() => result.current.stop());

    // Recette 1 du ticket, vue du guidage : un trajet interrompu en chemin ne
    // vaut pas un déplacement accompli, et n'entre donc pas dans le bilan.
    expect(onArrival).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe('idle');
  });
});
