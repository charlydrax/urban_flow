import type { RouteSourceName, SourceAvailability } from '@urbanflow/shared';
import { describe, expect, it } from 'vitest';

import { ApiError } from './api-client';
import {
  CACHED_ROUTE_NOTICE,
  PLAN_FAILURE_NOTICES,
  SOURCE_LABELS,
  classifyPlanFailure,
  describeAppliedConstraints,
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

  /** UF-601 — l'appareil hors-ligne ne se dit pas comme une panne de service. */
  describe('appareil hors-ligne (UF-601)', () => {
    it('distingue « hors-ligne » de « service indisponible »', () => {
      expect(classifyPlanFailure(new TypeError('Failed to fetch'), { online: false })).toBe(
        'offline',
      );
      // Le 503 fabriqué par le service worker quand il n'a aucun itinéraire en
      // cache : c'est encore l'appareil qui est hors-ligne, pas notre API.
      expect(classifyPlanFailure(new ApiError(503, 'Hors-ligne'), { online: false })).toBe(
        'offline',
      );
    });

    it('ne réécrit pas les erreurs de contrat, qui gardent leur sens', () => {
      const offline = { online: false };
      expect(classifyPlanFailure(new ApiError(401, 'Unauthorized'), offline)).toBe(
        'session-expired',
      );
      expect(classifyPlanFailure(new ApiError(400, 'invalide'), offline)).toBe('invalid-request');
      expect(classifyPlanFailure(new ApiError(404, 'Not Found'), offline)).toBe('no-route');
    });

    it('suppose le réseau présent quand rien n’est précisé (comportement d’avant UF-601)', () => {
      expect(classifyPlanFailure(new TypeError('Failed to fetch'), {})).toBe('unavailable');
      expect(classifyPlanFailure(new TypeError('Failed to fetch'), { online: true })).toBe(
        'unavailable',
      );
    });
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

    // Hors-ligne (UF-601) : l'appareil n'a plus de réseau, aucune relance n'y
    // changera rien avant son retour. Couper la parole au lecteur d'écran pour
    // annoncer un état qu'on ne peut pas corriger serait gratuit.
    expect(PLAN_FAILURE_NOTICES.offline.role).toBe('status');
  });

  it('n’invite pas à vérifier une connexion connue pour absente (UF-601)', () => {
    expect(PLAN_FAILURE_NOTICES.offline.message).not.toMatch(/[Vv]érifiez/);
  });
});

describe('CACHED_ROUTE_NOTICE (UF-601)', () => {
  it('annonce des résultats rejoués sans les faire passer pour une panne', () => {
    expect(CACHED_ROUTE_NOTICE.role).toBe('status');
  });

  it('dit explicitement que le trajet répond à la recherche précédente', () => {
    // C'est tout l'enjeu : un itinéraire d'hier affiché sans cette phrase se
    // lit comme la réponse à la question qu'on vient de poser.
    expect(CACHED_ROUTE_NOTICE.message).toMatch(/précédente/);
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

  it('impute le vide au filtre PMR quand c’est lui qui a tout retiré (UF-602, C12)', () => {
    const notice = describeEmptyResult(allAvailable(), { reducedMobility: true });

    // « Essayez une adresse plus proche d'un axe desservi » serait un mauvais
    // conseil : le réseau desservait bien ce trajet, mais pas en fauteuil.
    expect(notice.role).toBe('status');
    expect(notice.message).toContain('fauteuil roulant');
    expect(notice.message).toContain('profil');
  });

  it('donne la priorité à la panne totale sur le filtre (UF-602)', () => {
    const notice = describeEmptyResult(withFailed('transit', 'sharedMobility', 'cyclePaths'), {
      reducedMobility: true,
    });

    // Sans aucune donnée collectée, le filtre n'a rien pu écarter : lui
    // imputer le vide accuserait le réglage de l'usager à la place d'une panne.
    expect(notice.role).toBe('alert');
    expect(notice.message).toContain('Réessayez');
  });

  it('garde son message d’origine sans information sur les contraintes', () => {
    // Réponse rejouée depuis un cache antérieur à UF-602 : le champ n'existe pas.
    expect(describeEmptyResult(allAvailable(), undefined).message).toContain(
      'Aucun trajet disponible',
    );
    expect(describeEmptyResult(allAvailable(), null).message).toContain('Aucun trajet disponible');
  });
});

describe('describeAppliedConstraints', () => {
  it('annonce le filtre PMR sans le peindre comme un problème (C7/C12)', () => {
    const notice = describeAppliedConstraints({ reducedMobility: true });

    // `status` : la contrainte fait ce qu'on lui demande. Un `alert` ferait
    // chercher une panne dans un réglage volontaire.
    expect(notice?.role).toBe('status');
    expect(notice?.message).toContain('fauteuil roulant');
  });

  it('dit où le réglage se change, sinon l’annonce ne sert à rien', () => {
    expect(describeAppliedConstraints({ reducedMobility: true })?.message).toContain('profil');
  });

  it('ne dit rien quand aucune contrainte n’est active', () => {
    // Un bandeau permanent « aucun filtre » finirait par ne plus être lu, et
    // rendrait le vrai message invisible le jour où il paraît.
    expect(describeAppliedConstraints({ reducedMobility: false })).toBeNull();
  });

  it('ne dit rien tant qu’aucune réponse n’a été reçue', () => {
    expect(describeAppliedConstraints(null)).toBeNull();
    expect(describeAppliedConstraints(undefined)).toBeNull();
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
