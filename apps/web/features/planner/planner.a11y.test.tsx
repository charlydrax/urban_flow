import { TransportMode } from '@urbanflow/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GUEST_MODE_NOTICE, PLAN_FAILURE_NOTICES } from '../../lib/plan-feedback';
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

  describe('note du visiteur sans compte (UF-801)', () => {
    const renderGuestNotice = () =>
      render(
        <PlanNotice tone="info" role={GUEST_MODE_NOTICE.role} message={GUEST_MODE_NOTICE.message}>
          <p>
            <a href="/login">Connectez-vous</a> pour retrouver vos trajets et suivre votre impact
            CO₂.
          </p>
        </PlanNotice>,
      );

    it('ne viole aucune règle AA, lien de connexion compris', async () => {
      renderGuestNotice();
      await expectNoA11yViolations();
    });

    it('n’interrompt pas la lecture en cours (WCAG 4.1.3)', () => {
      renderGuestNotice();

      // Rien n'est cassé et rien n'est refusé : couper la parole au lecteur
      // d'écran ferait passer une information de contexte pour une alerte.
      expect(GUEST_MODE_NOTICE.role).toBe('status');
      expect(screen.getByRole('status')).toBeDefined();
    });

    it('offre une cible de connexion, plutôt qu’une injonction sans lien (WCAG 2.4.4)', () => {
      renderGuestNotice();

      const link = screen.getByRole('link', { name: /connectez-vous/i });
      expect(link.getAttribute('href')).toBe('/login');
    });

    it('dit ce qui manque sans laisser croire que la recherche est bloquée', () => {
      // Le planificateur fonctionne entièrement sans compte : un texte qui
      // laisserait entendre le contraire pousserait à s'inscrire pour un
      // service déjà rendu — une collecte obtenue par malentendu (C8).
      expect(GUEST_MODE_NOTICE.message).toMatch(/pas conserv|pas suivi/i);
      expect(GUEST_MODE_NOTICE.message).not.toMatch(/connectez-vous|inscri|obligatoire/i);
    });
  });
});
