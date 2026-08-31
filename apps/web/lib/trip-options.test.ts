import { MAX_TRAVELLERS, TransportMode } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRIP_OPTIONS,
  DEPART_NOW,
  MODE_CHOICES,
  SELECTABLE_MODES,
  clampTravellers,
  departureLabel,
  describeSearchOptions,
  isEcoModeActive,
  toDateTimeLocalValue,
  toPlanOptions,
  toggleMode,
  travellersLabel,
  type TripOptions,
} from './trip-options';

/**
 * Recette du modèle des options de recherche (UF-804).
 *
 * Le point le plus important de cette suite tient en une phrase : **un écran
 * qu'on n'a pas touché doit envoyer la requête d'avant le ticket**. Tout le
 * reste — chips, sélecteur, bandeau — n'a de valeur que si cette propriété
 * tient, sans quoi UF-804 aurait changé le comportement de tous les usagers qui
 * ne s'en servent pas.
 */
describe('toPlanOptions', () => {
  it('n’envoie aucun champ quand rien n’a été modifié', () => {
    // La requête produite est alors `{ from, to }` : exactement le corps
    // d'avant UF-804.
    expect(toPlanOptions(DEFAULT_TRIP_OPTIONS)).toEqual({});
  });

  it('n’envoie pas de date tant que la chip est sur « Maintenant »', () => {
    // Le moteur GTFS doit prendre l'instant lui-même : le figer ici le
    // calerait au moment où le formulaire prépare sa requête.
    expect(
      toPlanOptions({ ...DEFAULT_TRIP_OPTIONS, departAt: DEPART_NOW }).departAt,
    ).toBeUndefined();
  });

  it('sérialise l’heure choisie en ISO avec fuseau', () => {
    const payload = toPlanOptions({ ...DEFAULT_TRIP_OPTIONS, departAt: '2026-09-01T08:30' });

    expect(payload.departAt).toBeDefined();
    // La chaîne du champ HTML n'a pas de fuseau ; l'instant envoyé en a un, et
    // désigne bien 8 h 30 à l'heure de l'appareil.
    const sent = new Date(payload.departAt!);
    expect(sent.getHours()).toBe(8);
    expect(sent.getMinutes()).toBe(30);
  });

  it('ignore une valeur de date illisible plutôt que d’envoyer « Invalid Date »', () => {
    expect(toPlanOptions({ ...DEFAULT_TRIP_OPTIONS, departAt: 'pas une date' })).toEqual({});
  });

  it('n’envoie la taille du groupe que lorsqu’elle contraint', () => {
    expect(toPlanOptions({ ...DEFAULT_TRIP_OPTIONS, travellers: 1 }).travellers).toBeUndefined();
    expect(toPlanOptions({ ...DEFAULT_TRIP_OPTIONS, travellers: 4 }).travellers).toBe(4);
  });

  it('n’envoie les modes que lorsqu’une case a été décochée', () => {
    // « Tous les modes » n'est pas une contrainte : l'envoyer ferait publier au
    // serveur un `excludedModes` que personne n'a demandé, et l'écran
    // annoncerait un filtre inexistant.
    expect(toPlanOptions(DEFAULT_TRIP_OPTIONS).modes).toBeUndefined();

    const restreint = toggleMode(DEFAULT_TRIP_OPTIONS, TransportMode.SCOOTER);
    expect(toPlanOptions(restreint).modes).not.toContain(TransportMode.SCOOTER);
  });

  it('borne la taille du groupe avant l’envoi, comme l’API le fera (C4)', () => {
    expect(toPlanOptions({ ...DEFAULT_TRIP_OPTIONS, travellers: 999 }).travellers).toBe(
      MAX_TRAVELLERS,
    );
  });
});

describe('toggleMode', () => {
  it('décoche un mode retenu', () => {
    const next = toggleMode(DEFAULT_TRIP_OPTIONS, TransportMode.TRAM);
    expect(next.modes).not.toContain(TransportMode.TRAM);
  });

  it('recoche un mode écarté', () => {
    const sansTram = toggleMode(DEFAULT_TRIP_OPTIONS, TransportMode.TRAM);
    expect(toggleMode(sansTram, TransportMode.TRAM).modes).toContain(TransportMode.TRAM);
  });

  it('garde l’ordre de la planche quel que soit l’ordre des clics', () => {
    // Sans reconstruction depuis le catalogue, un mode recoché finirait en
    // queue de liste et l'ordre envoyé dépendrait du parcours de l'usager.
    let options: TripOptions = DEFAULT_TRIP_OPTIONS;
    options = toggleMode(options, TransportMode.BIKE);
    options = toggleMode(options, TransportMode.METRO);
    options = toggleMode(options, TransportMode.METRO);
    options = toggleMode(options, TransportMode.BIKE);

    expect(options.modes).toEqual([...SELECTABLE_MODES]);
  });

  it('refuse de décocher le dernier mode retenu', () => {
    // Une sélection vide ne laisserait aucune proposition constructible, et
    // rendrait une liste vide inexplicable (C10).
    const unSeul: TripOptions = { ...DEFAULT_TRIP_OPTIONS, modes: [TransportMode.BIKE] };
    expect(toggleMode(unSeul, TransportMode.BIKE)).toBe(unSeul);
  });
});

describe('MODE_CHOICES', () => {
  it('propose les six modes de la planche, dans son ordre', () => {
    expect(MODE_CHOICES.map((choice) => choice.mode)).toEqual([
      TransportMode.BIKE,
      TransportMode.BUS,
      TransportMode.METRO,
      TransportMode.TRAM,
      TransportMode.SCOOTER,
      TransportMode.WALK,
    ]);
  });

  it('n’offre pas le covoiturage, qu’aucune source ne fournit', () => {
    // Une case qui ne changerait jamais rien laisserait croire qu'on a cherché
    // des covoiturages (CLAUDE.md §3 : F3 couvre GTFS et GBFS, rien d'autre).
    expect(MODE_CHOICES.map((choice) => choice.mode)).not.toContain(TransportMode.CARPOOL);
  });

  it('nomme chaque mode en toutes lettres, à côté de son pictogramme', () => {
    for (const choice of MODE_CHOICES) {
      expect(choice.label.length).toBeGreaterThan(2);
      expect(choice.icon.length).toBeGreaterThan(0);
      expect(choice.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('clampTravellers', () => {
  it('borne des deux côtés', () => {
    expect(clampTravellers(0)).toBe(1);
    expect(clampTravellers(-3)).toBe(1);
    expect(clampTravellers(99)).toBe(MAX_TRAVELLERS);
  });

  it('retombe sur un voyageur devant une valeur illisible', () => {
    expect(clampTravellers(Number.NaN)).toBe(1);
  });
});

describe('travellersLabel', () => {
  it('accorde le singulier et le pluriel', () => {
    expect(travellersLabel(1)).toBe('1 personne');
    expect(travellersLabel(3)).toBe('3 personnes');
  });
});

describe('departureLabel', () => {
  const now = new Date(2026, 8, 1, 9, 0);

  it('dit « Maintenant » tant que rien n’a été choisi', () => {
    expect(departureLabel(DEPART_NOW, now)).toBe('Maintenant');
  });

  it('affiche l’heure seule pour une date du jour', () => {
    expect(departureLabel('2026-09-01T08:30', now)).toBe('Départ 08:30');
  });

  it('ajoute la date dès qu’on sort du jour', () => {
    // Sans la date, « Départ 08:30 » ne dirait pas de quel matin il s'agit.
    expect(departureLabel('2026-09-03T08:30', now)).toBe('Départ 03/09 à 08:30');
  });

  it('retombe sur « Maintenant » devant une valeur illisible, sans afficher d’erreur', () => {
    expect(departureLabel('', now)).toBe('Maintenant');
  });
});

describe('toDateTimeLocalValue', () => {
  it('rend la forme attendue par le champ HTML, en heure locale', () => {
    expect(toDateTimeLocalValue(new Date(2026, 8, 1, 8, 5))).toBe('2026-09-01T08:05');
  });
});

describe('isEcoModeActive', () => {
  it('est actif avant la première recherche — c’est le défaut du produit', () => {
    expect(isEcoModeActive(null)).toBe(true);
  });

  it('suit ce que le serveur a réellement fait', () => {
    expect(isEcoModeActive('carbonAsc')).toBe(true);
    // Un compte réglé sur « rapide » ne doit pas lire « bas carbone en
    // premier » au-dessus d'une liste classée par durée.
    expect(isEcoModeActive('durationAsc')).toBe(false);
  });
});

describe('describeSearchOptions', () => {
  it('ne dit rien quand aucune contrainte n’a été posée', () => {
    expect(describeSearchOptions({ reducedMobility: false })).toBeNull();
  });

  it('ne dit rien quand les contraintes du serveur sont inconnues', () => {
    expect(describeSearchOptions(null)).toBeNull();
  });

  it('nomme les modes écartés en toutes lettres', () => {
    const message = describeSearchOptions({
      reducedMobility: false,
      excludedModes: [TransportMode.METRO, TransportMode.TRAM],
    });

    expect(message).toMatch(/métro/i);
    expect(message).toMatch(/tram/i);
  });

  it('explique ce que la taille du groupe a retiré', () => {
    const message = describeSearchOptions({ reducedMobility: false, travellers: 4 });
    expect(message).toMatch(/4 véhicules/);
  });

  it('renvoie l’usager vers le réglage qu’il vient de poser', () => {
    // La différence avec le filtre PMR (UF-602) : celui-ci se règle dans le
    // profil, des semaines plus tôt ; ceux-ci se défont juste au-dessus.
    const message = describeSearchOptions({ reducedMobility: false, travellers: 2 });
    expect(message).toMatch(/au-dessus/i);
  });
});
