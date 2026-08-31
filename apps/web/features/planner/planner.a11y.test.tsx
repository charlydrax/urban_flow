import { TransportMode } from '@urbanflow/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ITINERARY_VIEWS } from '../../lib/itinerary-cards';
import { GUEST_MODE_NOTICE, PLAN_FAILURE_NOTICES } from '../../lib/plan-feedback';
import { departureCard, stationCard } from '../../lib/realtime-cards';
import { DEFAULT_TRIP_OPTIONS, SELECTABLE_MODES } from '../../lib/trip-options';
import { expectNoA11yViolations } from '../../test/axe';
import { ITINERARIES, STATIONS, TRANSPORT_STATUSES, itinerary } from '../../test/fixtures';
import { CarbonBreakdown } from './carbon-breakdown';
import { EcoModeBanner } from './eco-mode-banner';
import { ItineraryList } from './itinerary-list';
import { ItinerarySkeleton } from './itinerary-skeleton';
import { ModeSelector } from './mode-selector';
import { PlanNotice } from './plan-notice';
import { RealtimeCards } from './realtime-cards';
import { TripOptionsChips } from './trip-options-chips';

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

  it('le bandeau de filtres est un groupe nommé, pas quatre actions isolées (WCAG 4.1.2)', () => {
    renderList();
    expect(screen.getByRole('group', { name: /filtrer les itinéraires/i })).toBeDefined();
  });

  it('offre les quatre vues de la planche, une seule retenue (UF-804)', () => {
    renderList();

    const views = screen.getAllByRole<HTMLInputElement>('radio', {
      name: /^(tous|rapide|écolo|économe)/i,
    });
    expect(views).toHaveLength(ITINERARY_VIEWS.length);
    expect(views.filter((view) => view.checked)).toHaveLength(1);
  });

  it('ouvre sur « Tous » et annonce le tri réellement appliqué par le serveur', () => {
    renderList({ sortedBy: 'durationAsc' });

    // Le point de la vue par défaut : elle n'affirme pas un classement que le
    // serveur n'a pas fait. Un compte réglé sur « rapide » doit lire « durée ».
    const active = screen
      .getAllByRole<HTMLInputElement>('radio', { name: /^(tous|rapide|écolo|économe)/i })
      .find((view) => view.checked);
    expect(active?.value).toBe('all');
    expect(screen.getAllByText(/classés par durée croissante/i).length).toBeGreaterThan(0);
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

  // ------------------------------- UF-804 : options de recherche et cartes F3

  describe('options de recherche du planificateur (UF-804)', () => {
    it('les chips heure et voyageurs ne violent aucune règle AA', async () => {
      render(<TripOptionsChips options={DEFAULT_TRIP_OPTIONS} onChange={() => undefined} />);
      await expectNoA11yViolations();
    });

    it('les deux chips sont des contrôles nommés, pas des pastilles décoratives', () => {
      render(<TripOptionsChips options={DEFAULT_TRIP_OPTIONS} onChange={() => undefined} />);

      // La planche les dessine en badges ; ce sont ici de vrais contrôles, et
      // un lecteur d'écran doit pouvoir dire lequel il vient d'atteindre.
      expect(screen.getByRole('button', { name: /heure de départ/i })).toBeDefined();
      expect(screen.getByRole('combobox', { name: /voyageurs/i })).toBeDefined();
    });

    it('le sélecteur de modes ne viole aucune règle AA', async () => {
      render(<ModeSelector options={DEFAULT_TRIP_OPTIONS} onChange={() => undefined} />);
      await expectNoA11yViolations();
    });

    it('expose les six modes de la planche en cases à cocher, pas en boutons', () => {
      render(<ModeSelector options={DEFAULT_TRIP_OPTIONS} onChange={() => undefined} />);

      // Les modes ne s'excluent pas : le motif « case à cocher » est ce qui le
      // dit, là où des boutons laisseraient croire à un choix unique (WCAG 4.1.2).
      const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
      expect(boxes).toHaveLength(SELECTABLE_MODES.length);
      expect(boxes.every((box) => box.checked)).toBe(true);
      expect(screen.getByRole('group', { name: /modes de transport/i })).toBeDefined();
    });

    it('nomme chaque mode en toutes lettres, pas par son seul pictogramme (WCAG 1.1.1)', () => {
      render(<ModeSelector options={DEFAULT_TRIP_OPTIONS} onChange={() => undefined} />);

      for (const label of ['Vélo', 'Bus', 'Métro', 'Tram', 'Trottinette', 'Marche']) {
        expect(screen.getByRole('checkbox', { name: new RegExp(label, 'i') })).toBeDefined();
      }
    });

    it('verrouille la dernière case cochée plutôt que de laisser le clic échouer', () => {
      render(
        <ModeSelector
          options={{ ...DEFAULT_TRIP_OPTIONS, modes: [SELECTABLE_MODES[0]!] }}
          onChange={() => undefined}
        />,
      );

      const checked = screen
        .getAllByRole<HTMLInputElement>('checkbox')
        .filter((box) => box.checked);
      expect(checked).toHaveLength(1);
      expect(checked[0]!.disabled).toBe(true);
    });

    it.each([true, false])(
      'le bandeau « mode éco » (actif : %s) ne viole aucune règle AA',
      async (active) => {
        render(<EcoModeBanner active={active} isGuest={false} />);
        await expectNoA11yViolations();
      },
    );

    it('n’annonce le mode éco que lorsque le serveur classe par empreinte', () => {
      const { unmount } = render(<EcoModeBanner active isGuest={false} />);
      expect(screen.getByRole('status').textContent).toMatch(/mode éco activé/i);
      unmount();

      // Sinon il dit l'autre vérité, et donne le lien pour en changer : peindre
      // le message vert quand la liste est classée par durée serait un décor.
      render(<EcoModeBanner active={false} isGuest={false} />);
      expect(screen.getByRole('status').textContent).toMatch(/mode rapide/i);
      expect(screen.getByRole('link', { name: /profil/i })).toBeDefined();
    });

    it('renvoie un visiteur vers la connexion, pas vers un profil qu’il n’a pas', () => {
      render(<EcoModeBanner active={false} isGuest />);
      expect(screen.getByRole('link', { name: /connectez-vous/i }).getAttribute('href')).toBe(
        '/login',
      );
    });
  });

  describe('cartes temps réel (UF-804)', () => {
    const cards = [
      stationCard(STATIONS, TRANSPORT_STATUSES),
      departureCard(ITINERARIES[1]!, TRANSPORT_STATUSES),
    ].filter((card) => card !== null);

    it('les deux cartes ne violent aucune règle AA', async () => {
      render(<RealtimeCards cards={cards} />);
      await expectNoA11yViolations();
    });

    it('rend les deux encarts de la planche, dans une section nommée', () => {
      render(<RealtimeCards cards={cards} />);

      expect(cards).toHaveLength(2);
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
      expect(screen.getByRole('region', { name: /autour de votre départ/i })).toBeDefined();
    });

    it('énonce chaque encart en une phrase, jamais en fragments (WCAG 1.1.1)', () => {
      render(<RealtimeCards cards={cards} />);

      const station = screen.getByText(/station de véhicules en libre-service/i);
      expect(station.textContent).toMatch(/minutes à pied/i);
      expect(station.textContent).toMatch(/disponible/i);
      // La phrase est réservée au lecteur d'écran ; les fragments visibles sont
      // masqués pour ne pas être énoncés deux fois.
      expect(station.className).toContain('sr-only');
    });

    it('dit qu’un horaire de transport en commun est théorique, jamais « dans N min »', () => {
      render(<RealtimeCards cards={cards} />);

      const departure = screen.getByText(/prochain départ de votre itinéraire/i);
      // Nous n'avons pas de GTFS temps réel : un décompte affirmerait qu'on
      // suit le véhicule, ce que nous ne faisons pas (voir `realtime-cards.ts`).
      expect(departure.textContent).toMatch(/horaire théorique/i);
      expect(departure.textContent).not.toMatch(/dans \d+ min/i);
    });

    it('ne rend rien plutôt qu’un cadre creux quand il n’y a rien à dire', () => {
      const { container } = render(<RealtimeCards cards={[]} />);
      expect(container.innerHTML).toBe('');
    });
  });
});
