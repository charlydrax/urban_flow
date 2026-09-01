import { TransportMode, type CarbonSummary, type CarbonTripsPage } from '@urbanflow/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '../../test/axe';
import { CarbonDashboard } from './carbon-dashboard';

const getCarbonSummary = vi.fn();
const getCarbonTrips = vi.fn();
const updateProfile = vi.fn();

vi.mock('../../lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api-client')>('../../lib/api-client');
  return {
    ...actual,
    apiClient: {
      getCarbonSummary: (days?: number) => getCarbonSummary(days),
      getCarbonTrips: (days?: number) => getCarbonTrips(days),
      updateProfile: (payload: unknown) => updateProfile(payload),
    },
  };
});

const totals = (from: string, to: string, emittedGrams: number, tripsCount: number) => ({
  from,
  to,
  emittedGrams,
  carEquivalentGrams: emittedGrams * 4,
  avoidedGrams: emittedGrams * 3,
  tripsCount,
});

const SUMMARY: CarbonSummary = {
  current: totals('2026-07-29T12:00:00.000Z', '2026-08-28T12:00:00.000Z', 13_500, 12),
  previous: totals('2026-06-29T12:00:00.000Z', '2026-07-29T12:00:00.000Z', 16_900, 14),
  emittedChangePercent: -20,
  buckets: [
    totals('2026-07-29T12:00:00.000Z', '2026-08-05T12:00:00.000Z', 4_000, 3),
    totals('2026-08-05T12:00:00.000Z', '2026-08-13T12:00:00.000Z', 3_500, 3),
    totals('2026-08-13T12:00:00.000Z', '2026-08-20T12:00:00.000Z', 3_000, 3),
    totals('2026-08-20T12:00:00.000Z', '2026-08-28T12:00:00.000Z', 3_000, 3),
  ],
  uncountedTripsCount: 3,
  modeBreakdown: [
    { mode: TransportMode.BUS, distanceMeters: 62_000, grams: 5_900, tripsCount: 7 },
    { mode: TransportMode.METRO, distanceMeters: 48_000, grams: 3_800, tripsCount: 5 },
    { mode: TransportMode.WALK, distanceMeters: 6_400, grams: 0, tripsCount: 9 },
  ],
  goal: { monthlyGrams: 16_000, periodGrams: 16_000, emittedGrams: 13_500, usedPercent: 84 },
};

const TRIPS: CarbonTripsPage = {
  trips: [
    {
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
    },
  ],
  truncated: false,
};

/**
 * Audit d'accessibilité de la page « Mon impact » complétée (UF-805, C7).
 *
 * Trois motifs neufs y arrivent d'un coup, et chacun a sa façon de mal
 * vieillir :
 *
 * - la **répartition par mode** est une pile de barres colorées — le genre de
 *   bloc qu'un lecteur d'écran annonce comme une suite de nombres sans verbe si
 *   personne n'a écrit la phrase qui le résume (WCAG 1.1.1) ;
 * - le **tableau par trajet** est un vrai `<table>` : en-têtes de colonnes,
 *   en-têtes de lignes, légende. C'est ce que la première refonte « moderne »
 *   en grille de `div` fait disparaître (WCAG 1.3.1) ;
 * - l'**objectif** est un formulaire dépliant, donc un `aria-expanded` à tenir
 *   à jour et un champ à étiqueter (WCAG 4.1.2).
 */
describe('suivi carbone — WCAG 2.1 AA', () => {
  beforeEach(() => {
    getCarbonSummary.mockReset().mockResolvedValue(SUMMARY);
    getCarbonTrips.mockReset().mockResolvedValue(TRIPS);
    updateProfile.mockReset().mockResolvedValue({});
  });

  it('ne viole aucune règle AA une fois le bilan chargé', async () => {
    const { container } = render(<CarbonDashboard />);
    await screen.findByRole('heading', { name: /émissions par mode/i });

    await expectNoA11yViolations(container);
  });

  it('énonce la répartition par mode en une phrase, pas en une suite de nombres', async () => {
    render(<CarbonDashboard />);

    // Les barres sont en `aria-hidden` : c'est cette phrase que la synthèse
    // vocale annonce à leur place.
    expect(await screen.findByText(/Répartition de vos 13,5 kg CO₂ par mode/)).toBeTruthy();
  });

  it('affiche l’objectif avec son état écrit, pas seulement en couleur', async () => {
    render(<CarbonDashboard />);

    await screen.findByRole('heading', { name: /objectif : rester sous 16 kg/i });
    // Le vert dit « ça va » à qui le distingue ; le mot le dit à tout le monde
    // (WCAG 1.4.1).
    expect(screen.getByText(/en bonne voie/)).toBeTruthy();
  });

  it('ne demande les trajets qu’une fois le tableau déplié (C5)', async () => {
    render(<CarbonDashboard />);

    const toggle = await screen.findByRole('button', { name: /voir le détail/i });
    expect(getCarbonTrips).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    await waitFor(() => expect(getCarbonTrips).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole('button', { name: /masquer le détail/i }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('publie le détail dans un vrai tableau, en-têtes compris', async () => {
    const { container } = render(<CarbonDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: /voir le détail/i }));

    // Portée au tableau des trajets : le graphique d'évolution publie lui aussi
    // son équivalent tabulaire, et une recherche globale trouverait les deux.
    const table = within(await screen.findByRole('table', { name: /trajets retenus sur les/i }));

    expect(table.getByRole('columnheader', { name: /co₂ évité/i })).toBeTruthy();
    // L'en-tête de LIGNE est ce qui permet d'annoncer « République → Bellecour,
    // CO₂ émis, 204 g » plutôt qu'un « 204 g » orphelin (WCAG 1.3.1).
    expect(table.getByRole('rowheader', { name: /république → bellecour/i })).toBeTruthy();

    await expectNoA11yViolations(container);
  });

  it('n’audite pas un formulaire d’objectif sans étiquette', async () => {
    const { container } = render(<CarbonDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: /modifier l’objectif/i }));

    expect(
      screen.getByRole('spinbutton', { name: /budget mensuel, en kilogrammes/i }),
    ).toBeTruthy();

    await expectNoA11yViolations(container);
  });
});
