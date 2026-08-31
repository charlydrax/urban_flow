import { TransportMode, type Itinerary, type RouteSegment } from '@urbanflow/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  INITIAL_NAVIGATION_STATE,
  navigationReducer,
  type NavigationEvent,
  type NavigationState,
} from '../../lib/navigation-machine';
import { expectNoA11yViolations } from '../../test/axe';
import { NavigationSheet } from './navigation-sheet';
import { StartNavigation } from './start-navigation';

const LAT = 45.76;

function segment(
  mode: TransportMode,
  durationMinutes: number,
  coordinates: [number, number][],
  extra: Partial<RouteSegment> = {},
): RouteSegment {
  return {
    mode,
    from: 'A',
    to: 'B',
    durationMinutes,
    distanceMeters: 1000,
    carbonGrams: 120,
    geometry: { type: 'LineString', coordinates },
    ...extra,
  };
}

const TRIP: Itinerary = {
  id: 'itin-1',
  summary: 'Vélo + Bus C3',
  durationMinutes: 16,
  distanceMeters: 2000,
  carbonGrams: 240,
  accessible: false,
  segments: [
    segment(TransportMode.BIKE, 10, [
      [4.85, LAT],
      [4.852, LAT],
    ]),
    segment(TransportMode.BUS, 6, [
      [4.852, LAT],
      [4.856, LAT],
    ]),
  ],
};

function run(...events: NavigationEvent[]): NavigationState {
  return events.reduce(navigationReducer, INITIAL_NAVIGATION_STATE);
}

const START: NavigationEvent = { type: 'start', itinerary: TRIP };
const position = (lng: number, lat = LAT) => ({ lat, lng, accuracyMeters: 12 });

function renderSheet(state: NavigationState, following = true) {
  const handlers = {
    onFollowAgain: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
  };
  render(<NavigationSheet state={state} following={following} {...handlers} />);
  return handlers;
}

describe('NavigationSheet — accessibilité (C7)', () => {
  it('ne relève aucune violation axe en cours de guidage', async () => {
    renderSheet(run(START, { type: 'position', position: position(4.851) }));

    await expectNoA11yViolations();
  });

  it('ne relève aucune violation axe en pause, hors tracé, et à l’arrivée', async () => {
    for (const state of [
      run(START, { type: 'position', position: position(4.851) }, { type: 'pause' }),
      run(START, { type: 'position', position: position(4.851, LAT + 0.002) }),
      run(START, { type: 'signal-lost', reason: 'timeout' }),
      run(START, { type: 'position', position: position(4.856) }),
    ]) {
      const { unmount } = render(
        <NavigationSheet
          state={state}
          following
          onFollowAgain={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onStop={vi.fn()}
        />,
      );
      await expectNoA11yViolations();
      unmount();
    }
  });
});

describe('NavigationSheet — ce que l’écran dit', () => {
  it('affiche le reste de l’étape en cours et l’heure d’arrivée', () => {
    renderSheet(run(START, { type: 'position', position: position(4.851) }));

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Encore 5 min en vélo');
    // L'heure exacte dépend de l'instant du test : c'est son étiquette qui est
    // vérifiée ici, la valeur l'étant dans `navigation-machine.test.ts`.
    screen.getByText('Arrivée');
  });

  it('nomme le statut de chaque étape autrement que par la couleur (WCAG 1.4.1)', () => {
    renderSheet(run(START, { type: 'position', position: position(4.854) }));

    const steps = screen.getByRole('list').textContent ?? '';
    expect(steps).toContain('Vélo, étape faite');
    expect(steps).toContain('Bus, étape en cours');
  });

  it('bascule le libellé du bouton principal entre pause et reprise', () => {
    const guiding = run(START, { type: 'position', position: position(4.851) });
    const { onPause } = renderSheet(guiding);

    const pauseButton = screen.getByRole('button', { name: /Mettre en pause/ });
    fireEvent.click(pauseButton);
    expect(onPause).toHaveBeenCalledOnce();

    screen.getByRole('button', { name: /Arrêter la navigation/ });
  });

  it('propose « Reprendre le guidage » une fois en pause', () => {
    const { onResume } = renderSheet(run(START, { type: 'pause' }));

    fireEvent.click(screen.getByRole('button', { name: /Reprendre le guidage/ }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('décrit le suivi de caméra comme un interrupteur, et le désactive quand il est actif', () => {
    const guiding = run(START, { type: 'position', position: position(4.851) });
    renderSheet(guiding, true);

    const camera = screen.getByRole('button', { name: /La carte suit votre position/ });
    expect(camera.getAttribute('aria-pressed')).toBe('true');
    expect((camera as HTMLButtonElement).disabled).toBe(true);
  });

  it('réactive le bouton de recentrage dès que le suivi est coupé', () => {
    const guiding = run(START, { type: 'position', position: position(4.851) });
    const { onFollowAgain } = renderSheet(guiding, false);

    const camera = screen.getByRole('button', { name: /Recentrer la carte sur ma position/ });
    expect(camera.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(camera);
    expect(onFollowAgain).toHaveBeenCalledOnce();
  });

  it('avertit d’un écart au tracé sans retirer les commandes du guidage', () => {
    // ~222 m au nord de l'itinéraire.
    renderSheet(run(START, { type: 'position', position: position(4.851, LAT + 0.002) }));

    expect(screen.getByRole('status').textContent).toMatch(/de l’itinéraire/);
    // Le guidage continue : le bouton de pause est toujours là.
    screen.getByRole('button', { name: /Mettre en pause/ });
  });

  it('explique la perte de signal avec le message normalisé du capteur (C6)', () => {
    renderSheet(run(START, { type: 'signal-lost', reason: 'denied' }));

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Signal perdu');
    // Deux occurrences, et c'est voulu : le sous-titre visible et l'annonce
    // `aria-live` disent la même chose à deux publics différents.
    expect(screen.getAllByText(/refusé la géolocalisation/)).toHaveLength(2);
  });

  it('ne propose plus que « Terminer » une fois arrivé', () => {
    const { onStop } = renderSheet(run(START, { type: 'position', position: position(4.856) }));

    expect(screen.queryByRole('button', { name: /pause/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Terminer' }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe('StartNavigation', () => {
  it('ne relève aucune violation axe', async () => {
    render(<StartNavigation itinerary={TRIP} awaitingConsent={false} onStart={vi.fn()} />);

    await expectNoA11yViolations();
  });

  it('nomme l’itinéraire qu’il lancera (WCAG 2.4.6)', () => {
    render(<StartNavigation itinerary={TRIP} awaitingConsent={false} onStart={vi.fn()} />);

    screen.getByRole('button', { name: /Démarrer la navigation sur l’itinéraire 16 minutes/ });
  });

  it('annonce l’attente du consentement plutôt que de rester grisé sans mot', () => {
    const onStart = vi.fn();
    render(<StartNavigation itinerary={TRIP} awaitingConsent onStart={onStart} />);

    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Localisation en cours…');
  });

  it('transmet l’itinéraire retenu au démarrage', () => {
    const onStart = vi.fn();
    render(<StartNavigation itinerary={TRIP} awaitingConsent={false} onStart={onStart} />);

    fireEvent.click(screen.getByRole('button'));
    expect(onStart).toHaveBeenCalledWith(TRIP);
  });
});
