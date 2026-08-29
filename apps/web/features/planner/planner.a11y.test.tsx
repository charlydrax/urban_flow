import { TransportMode } from '@urbanflow/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PLAN_FAILURE_NOTICES } from '../../lib/plan-feedback';
import { expectNoA11yViolations } from '../../test/axe';
import { ITINERARIES, itinerary } from '../../test/fixtures';
import { CarbonBreakdown } from './carbon-breakdown';
import { ItineraryList } from './itinerary-list';
import { ItinerarySkeleton } from './itinerary-skeleton';
import { PlanNotice } from './plan-notice';

/**
 * Audit d'accessibilité du panneau de résultats (UF-602, C7).
 *
 * C'est l'écran le plus dense du produit, et celui qui porte le plus
 * d'information **non textuelle** : couleurs de modes, pastilles de niveau
 * carbone, pictogrammes. Chaque passage d'axe est donc doublé d'une
 * vérification sémantique : passer axe prouve qu'aucune règle mécanique n'est
 * violée, pas que l'écran raconte quelque chose de juste à un lecteur d'écran.
 */
describe('panneau de résultats — WCAG 2.1 AA', () => {
  function renderList(props: Partial<Parameters<typeof ItineraryList>[0]> = {}) {
    return render(
      <ItineraryList
        itineraries={ITINERARIES}
        selectedId={null}
        sortedBy="carbonAsc"
        onSelect={() => undefined}
        {...props}
      />,
    );
  }

  it('la liste d’itinéraires ne viole aucune règle AA', async () => {
    renderList({ selectedId: ITINERARIES[0].id });
    await expectNoA11yViolations();
  });

  it('expose les itinéraires comme un groupe de choix nommé (WCAG 4.1.2)', () => {
    renderList({ selectedId: ITINERARIES[0].id });

    const options = screen.getAllByRole<HTMLInputElement>('radio', { name: /option \d+ sur/i });
    expect(options).toHaveLength(ITINERARIES.length);
    expect(options.filter((option) => option.checked)).toHaveLength(1);

    // Le groupe est nommé : sans légende, un lecteur d'écran annonce trois
    // boutons radio sans dire de quel choix il s'agit.
    expect(screen.getByRole('group', { name: /choisir un itinéraire/i })).toBeDefined();
  });

  it('énonce durée, modes et empreinte en toutes lettres, sans dépendre d’une couleur (WCAG 1.4.1)', () => {
    renderList();

    const [first] = screen.getAllByRole('radio', { name: /option \d+ sur/i });
    const label = first.getAttribute('aria-label') ?? '';

    expect(label).toMatch(/\d+\s*min/i);
    expect(label).toMatch(/vélo|métro|bus|marche/i);
    expect(label).toMatch(/CO/);
  });

  it('annonce l’accessibilité fauteuil d’un itinéraire qui la porte (C12)', () => {
    render(
      <ItineraryList
        itineraries={[itinerary({ id: 'itin-pmr', accessible: true })]}
        selectedId={null}
        sortedBy="carbonAsc"
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByRole('radio', { name: /fauteuil roulant/i })).toBeDefined();
  });

  it('le sélecteur de tri est un groupe nommé, pas deux actions isolées (WCAG 4.1.2)', () => {
    renderList();
    expect(screen.getByRole('group', { name: /trier les itinéraires/i })).toBeDefined();
  });

  it('le détail carbone ne viole aucune règle AA', async () => {
    render(
      <CarbonBreakdown
        itinerary={itinerary({
          carbon: {
            totalGrams: 380,
            carEquivalentGrams: 1165,
            avoidedGrams: 785,
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
          },
        })}
      />,
    );

    await expectNoA11yViolations();
  });

  it('le squelette de chargement ne viole aucune règle AA', async () => {
    render(<ItinerarySkeleton />);
    await expectNoA11yViolations();
  });

  it.each(Object.entries(PLAN_FAILURE_NOTICES))(
    'le message d’échec « %s » ne viole aucune règle AA',
    async (_failure, notice) => {
      render(<PlanNotice tone="error" role={notice.role} message={notice.message} />);
      await expectNoA11yViolations();
    },
  );
});
