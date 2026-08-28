import type { RouteSourceName, SourceAvailability } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import { ApiError } from './api-client';
import {
  PLAN_FAILURE_NOTICES,
  SOURCE_LABELS,
  classifyPlanFailure,
  describeDegradedSources,
  describeEmptyResult,
} from './plan-feedback';

/** Les trois sources telles que l'API les publie, toutes disponibles. */
function allAvailable(): SourceAvailability[] {
  return [
    { source: 'transit', available: true },
    { source: 'sharedMobility', available: true },
    { source: 'cyclePaths', available: true },
  ];
}

/** Les trois sources, avec celles nommées en échec. */
function withFailed(...failed: RouteSourceName[]): SourceAvailability[] {
  return allAvailable().map((source) =>
    failed.includes(source.source)
      ? { source: source.source, available: false, reason: 'timeout' as const }
      : source,
  );
}

describe('classifyPlanFailure', () => {
  it('reconnaît la session expirée (401)', () => {
    expect(classifyPlanFailure(new ApiError(401, 'Unauthorized'))).toBe('session-expired');
  });

  it('reconnaît une requête refusée (400)', () => {
    expect(classifyPlanFailure(new ApiError(400, 'coordonnées manquantes'))).toBe(
      'invalid-request',
    );
  });

  it('reconnaît le « aucun trajet » du diagramme (404)', () => {
    expect(classifyPlanFailure(new ApiError(404, 'Not Found'))).toBe('no-route');
  });

  it('range les pannes serveur dans « indisponible »', () => {
    expect(classifyPlanFailure(new ApiError(500, 'Internal'))).toBe('unavailable');
    expect(classifyPlanFailure(new ApiError(503, 'Unavailable'))).toBe('unavailable');
  });

  it('ne suppose pas que le rejet est une ApiError', () => {
    // Coupure réseau : `fetch` rejette avec un TypeError, pas avec notre erreur.
    expect(classifyPlanFailure(new TypeError('Failed to fetch'))).toBe('unavailable');
    expect(classifyPlanFailure(undefined)).toBe('unavailable');
  });
});

describe('PLAN_FAILURE_NOTICES', () => {
  it('ne divulgue ni statut HTTP ni détail serveur (C11)', () => {
    for (const { message } of Object.values(PLAN_FAILURE_NOTICES)) {
      expect(message).not.toMatch(/\b[45]\d\d\b/);
      expect(message.toLowerCase()).not.toContain('http');
    }
  });

  it('n’alerte que sur ce qui est réellement une panne (C7)', () => {
    // La session expirée s'accompagne d'une redirection déjà lancée : le
    // message l'explique, il n'a pas à couper la parole au lecteur d'écran.
    expect(PLAN_FAILURE_NOTICES['session-expired'].role).toBe('status');
    expect(PLAN_FAILURE_NOTICES.unavailable.role).toBe('alert');
    expect(PLAN_FAILURE_NOTICES['invalid-request'].role).toBe('alert');
  });
});

describe('describeEmptyResult', () => {
  it('annonce une absence de trajet comme un résultat, pas comme une panne', () => {
    const notice = describeEmptyResult(allAvailable());

    // `status` et non `alert` : envoyer l'usager vérifier sa connexion parce
    // qu'aucun trajet n'existe serait un contresens (C7 / C10).
    expect(notice.role).toBe('status');
    expect(notice.message).toContain('Aucun trajet disponible');
  });

  it('distingue « personne n’a répondu » de « rien à proposer »', () => {
    const notice = describeEmptyResult(withFailed('transit', 'sharedMobility', 'cyclePaths'));

    expect(notice.role).toBe('alert');
    expect(notice.message).toContain('Réessayez');
  });

  it('reste neutre quand l’état des sources est inconnu (404 d’un intermédiaire)', () => {
    const notice = describeEmptyResult([]);

    expect(notice.role).toBe('status');
    expect(notice.message).toContain('Aucun trajet disponible');
  });
});

describe('describeDegradedSources', () => {
  it('ne signale rien quand les trois sources ont répondu', () => {
    expect(describeDegradedSources(allAvailable())).toBeNull();
  });

  it('ne double pas le message de panne totale', () => {
    // Toutes les sources muettes : c'est `describeEmptyResult` qui le dit, et
    // le dire deux fois reviendrait à minimiser la seconde.
    expect(
      describeDegradedSources(withFailed('transit', 'sharedMobility', 'cyclePaths')),
    ).toBeNull();
  });

  it('nomme la source absente en français, sans jargon', () => {
    const notice = describeDegradedSources(withFailed('sharedMobility'));

    expect(notice).not.toBeNull();
    expect(notice?.missing).toEqual(['sharedMobility']);
    expect(notice?.message).toContain(SOURCE_LABELS.sharedMobility);
    expect(notice?.message).toContain('Certaines options peuvent manquer');
  });

  it('énumère plusieurs sources absentes avec un « et » final', () => {
    const notice = describeDegradedSources(withFailed('transit', 'cyclePaths'));

    expect(notice?.missing).toEqual(['transit', 'cyclePaths']);
    expect(notice?.message).toContain(`${SOURCE_LABELS.transit} et ${SOURCE_LABELS.cyclePaths}`);
  });

  it('ne publie pas la cause technique de l’indisponibilité (C11)', () => {
    const notice = describeDegradedSources(withFailed('transit'));

    expect(notice?.message).not.toContain('timeout');
    expect(notice?.message).not.toContain('upstream');
  });
});
