import { TransportMode, type SharedMobilityStation } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import { ITINERARIES, STATIONS, TRANSPORT_STATUSES, itinerary, segment } from '../test/fixtures';
import { departureCard, stationCard } from './realtime-cards';

/**
 * Recette des deux cartes temps réel (UF-804).
 *
 * L'enjeu de cette suite n'est pas l'affichage mais l'**honnêteté** : ces deux
 * encarts sont les seuls du produit à afficher une donnée qu'on annonce comme
 * temps réel, et l'un des deux ne l'est pas. Ce qui est vérifié ici, c'est que
 * chacun dise ce qu'il est.
 */
describe('stationCard', () => {
  it('retient la première borne qui loue réellement', () => {
    // La borne la plus proche du jeu est hors service : la carte doit passer à
    // la suivante plutôt que d'annoncer « 0 véhicule ».
    const card = stationCard(STATIONS, TRANSPORT_STATUSES);

    expect(card?.title).toContain('LAFAYETTE / GARIBALDI');
    expect(card?.emphasis).toBe('7 véhicules disponibles');
  });

  it('convertit la distance en minutes de marche, au modèle de l’API', () => {
    // 240 m à 80 m/min : trois minutes. Le même barème que `travel-model.ts`
    // côté serveur — deux vitesses de marche donneraient deux temps pour le
    // même trajet selon l'écran regardé (C9).
    expect(stationCard(STATIONS, TRANSPORT_STATUSES)?.detail).toBe('À 3 min à pied');
  });

  it('accorde le singulier quand il ne reste qu’un véhicule', () => {
    const seule: SharedMobilityStation[] = [
      { ...STATIONS[1]!, vehiclesAvailable: 1, vehicles: [] },
    ];
    expect(stationCard(seule, TRANSPORT_STATUSES)?.emphasis).toBe('1 véhicule disponible');
  });

  it('ne rend rien plutôt qu’une carte vide quand aucune borne ne loue', () => {
    expect(stationCard([STATIONS[0]!], TRANSPORT_STATUSES)).toBeNull();
    expect(stationCard([], TRANSPORT_STATUSES)).toBeNull();
  });

  it('annonce la donnée comme temps réel — parce qu’elle l’est', () => {
    expect(stationCard(STATIONS, TRANSPORT_STATUSES)?.provenance).toMatch(/temps réel/i);
    expect(stationCard(STATIONS, TRANSPORT_STATUSES)?.stale).toBe(false);
  });

  it('nuance la disponibilité quand le flux est signalé figé, sans la cacher (C10)', () => {
    // Une station qui existait il y a un quart d'heure existe encore ; c'est le
    // *nombre* qui n'engage plus grand-chose. On le dit, on ne le retire pas.
    const figé = TRANSPORT_STATUSES.map((status) =>
      status.source === 'gbfs' ? { ...status, status: 'degraded' as const } : status,
    );
    const card = stationCard(STATIONS, figé);

    expect(card?.emphasis).toBe('7 véhicules disponibles');
    expect(card?.stale).toBe(true);
    expect(card?.provenance).toMatch(/figé/i);
  });
});

describe('departureCard', () => {
  const metro = ITINERARIES[1]!;

  it('annonce le premier segment en transport en commun de l’option retenue', () => {
    const card = departureCard(metro, TRANSPORT_STATUSES);

    expect(card?.title).toBe('Métro B → Bellecour');
    expect(card?.detail).toBe('Arrêt Saxe-Gambetta');
    expect(card?.emphasis).toBe('départ à 09:47');
  });

  it('ne répète pas l’heure entre le détail et l’emphase', () => {
    // L'encart recolle les deux avec un point médian : une heure présente des
    // deux côtés s'affichait « Arrêt X · départ à 19:42 · départ à 19:42 ».
    const card = departureCard(metro, TRANSPORT_STATUSES);

    expect(card?.detail).not.toMatch(/\d{2}:\d{2}/);
  });

  it('affiche une heure, jamais un décompte', () => {
    // Nous n'avons pas de GTFS temps réel : « passe dans 4 min » affirmerait
    // qu'on suit le véhicule, ce qui serait faux et invérifiable par l'usager
    // tant qu'il n'est pas à l'arrêt.
    const card = departureCard(metro, TRANSPORT_STATUSES);

    expect(card?.emphasis).not.toMatch(/dans \d+ min/i);
    expect(card?.provenance).toMatch(/théorique/i);
    expect(card?.description).toMatch(/pas la position réelle du véhicule/i);
  });

  it('ne rend rien quand l’option retenue n’emprunte aucun transport en commun', () => {
    const velo = itinerary({ id: 'itin-velo-only', segments: [segment(TransportMode.BIKE, 22)] });

    expect(departureCard(velo, TRANSPORT_STATUSES)).toBeNull();
  });

  it('ne rend rien tant qu’aucune option n’est retenue', () => {
    expect(departureCard(null, TRANSPORT_STATUSES)).toBeNull();
  });

  it('signale une source injoignable plutôt que d’afficher un horaire sans réserve', () => {
    const coupé = TRANSPORT_STATUSES.map((status) =>
      status.source === 'gtfs' ? { ...status, status: 'down' as const } : status,
    );
    const card = departureCard(metro, coupé);

    expect(card?.stale).toBe(true);
    expect(card?.provenance).toMatch(/injoignable/i);
  });

  it('se passe d’heure plutôt que d’en inventer une', () => {
    const sansHoraire = itinerary({
      id: 'itin-sans-horaire',
      segments: [
        segment(TransportMode.BUS, 9, { line: 'C3', from: 'Cordeliers', to: 'Part-Dieu' }),
      ],
    });
    const card = departureCard(sansHoraire, TRANSPORT_STATUSES);

    expect(card?.detail).toBe('Arrêt Cordeliers');
    expect(card?.emphasis).toBeNull();
  });
});
