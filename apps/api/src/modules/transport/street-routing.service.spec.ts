import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { TransportMode } from '../../common/enums/transport-mode.enum';
import { OtpClient, OtpUnavailableError } from './otp/otp.client';
import {
  StreetRoutingService,
  streetPathKey,
  type StreetPathQuery,
} from './street-routing.service';

/**
 * Recette UF-702, volet « routeur de voirie » :
 * - un segment marche obtient une polyligne qui suit les rues ;
 * - un segment vélo passe par le profil cyclable ;
 * - un segment TC n'est jamais routé (sa forme vient déjà du GTFS) ;
 * - une panne du moteur ne lève pas et ne rend simplement aucun tracé ;
 * - la même demande n'est pas envoyée deux fois (déduplication, puis cache) ;
 * - un moteur trop lent ne retient pas la réponse au-delà du budget.
 */

/** Les deux pôles du scénario de référence (CLAUDE.md — le trajet de « Marie »). */
const PART_DIEU = { lat: 45.76052, lng: 4.85906 };
const NEARBY = { lat: 45.7599, lng: 4.857 };

/** Trois points de la rue Garibaldi, encodés en polyligne Google (précision 5). */
const WALK_POINTS = 'grhvGc`t\\VrEbBfE';

/** La suite du même cheminement — sert à vérifier la concaténation des pas. */
const NEXT_POINTS = 'knhvGgss\\rDfErDfE';

/** Une demande de cheminement piéton entre les deux points ci-dessus. */
const WALK_QUERY: StreetPathQuery = {
  mode: TransportMode.WALK,
  from: PART_DIEU,
  to: NEARBY,
  wheelchair: false,
};

/** Réponse OTP minimale : un itinéraire, un pas, une polyligne. */
function planWith(...encoded: string[]) {
  return {
    plan: {
      itineraries: [{ legs: encoded.map((points) => ({ legGeometry: { points } })) }],
    },
  };
}

describe('StreetRoutingService', () => {
  let service: StreetRoutingService;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue(planWith(WALK_POINTS));

    const moduleRef = await Test.createTestingModule({
      providers: [
        StreetRoutingService,
        { provide: OtpClient, useValue: { query } },
        // Le budget de la rafale est plafonné par le délai d'OTP : une valeur
        // large laisse les tests nominaux se dérouler sans course.
        { provide: ConfigService, useValue: { get: () => 5000 } },
      ],
    }).compile();

    service = moduleRef.get(StreetRoutingService);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);
  });

  it('rend le cheminement piéton décodé, en [lng, lat] (C9)', async () => {
    const paths = await service.routePaths([WALK_QUERY]);

    expect(paths.get(streetPathKey(WALK_QUERY))).toEqual({
      type: 'LineString',
      coordinates: [
        [4.85906, 45.76052],
        [4.858, 45.7604],
        [4.857, 45.7599],
      ],
    });
  });

  it('concatène les pas du cheminement sans dupliquer leur point de jonction (C5)', async () => {
    query.mockResolvedValue(planWith(WALK_POINTS, NEXT_POINTS));

    const paths = await service.routePaths([WALK_QUERY]);
    const coordinates = paths.get(streetPathKey(WALK_QUERY))?.coordinates ?? [];

    // Trois points + trois points, moins la jonction commune : cinq sommets.
    expect(coordinates).toHaveLength(5);
    expect(coordinates[2]).toEqual([4.857, 45.7599]);
    expect(coordinates[4]).toEqual([4.855, 45.7581]);
  });

  it('demande le profil cyclable pour un vélo et piéton pour une marche', async () => {
    await service.routePaths([
      WALK_QUERY,
      { ...WALK_QUERY, mode: TransportMode.BIKE },
      { ...WALK_QUERY, mode: TransportMode.SCOOTER },
    ]);

    const modes = query.mock.calls.map(([, variables]) => variables.mode);
    expect(modes).toEqual(expect.arrayContaining(['WALK', 'BICYCLE']));
    // La trottinette emprunte le réseau cyclable : elle ne crée pas un profil.
    expect(modes.filter((mode: string) => mode === 'BICYCLE')).toHaveLength(2);
  });

  it("n'interroge jamais le moteur pour un segment de transport en commun", async () => {
    const paths = await service.routePaths([{ ...WALK_QUERY, mode: TransportMode.METRO }]);

    expect(query).not.toHaveBeenCalled();
    expect(paths.size).toBe(0);
  });

  it('propage la contrainte PMR au cheminement demandé (C12)', async () => {
    await service.routePaths([{ ...WALK_QUERY, wheelchair: true }]);

    expect(query).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ wheelchair: true }),
      'streetPath',
    );
  });

  it('ne demande qu’une fois un cheminement répété dans plusieurs itinéraires (C5)', async () => {
    await service.routePaths([WALK_QUERY, { ...WALK_QUERY }, { ...WALK_QUERY }]);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('sert le cache à la recherche suivante, sans rappeler le moteur (C5)', async () => {
    await service.routePaths([WALK_QUERY]);
    const paths = await service.routePaths([WALK_QUERY]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(paths.has(streetPathKey(WALK_QUERY))).toBe(true);
  });

  it('ne lève pas quand le moteur est injoignable, et ne rend aucun tracé (C10)', async () => {
    query.mockRejectedValue(new OtpUnavailableError('network', 'OTP injoignable.'));

    await expect(service.routePaths([WALK_QUERY])).resolves.toEqual(new Map());
  });

  it("mémorise l'absence de chemin pour ne pas la redemander à chaque recherche", async () => {
    query.mockResolvedValue({ plan: { itineraries: [] } });

    await service.routePaths([WALK_QUERY]);
    const paths = await service.routePaths([WALK_QUERY]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(paths.size).toBe(0);
  });

  it('abandonne la rafale passé son budget plutôt que de retarder la réponse (C10)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StreetRoutingService,
        {
          provide: OtpClient,
          // Un moteur qui accepte la requête puis se tait : sans budget, la
          // recherche de l'usager attendrait ce `setTimeout` jusqu'au bout.
          useValue: { query: jest.fn(() => new Promise(() => undefined)) },
        },
        { provide: ConfigService, useValue: { get: () => 30 } },
      ],
    }).compile();

    const slow = moduleRef.get(StreetRoutingService);
    jest.spyOn(slow['logger'], 'log').mockImplementation(() => undefined);

    const startedAt = Date.now();
    const paths = await slow.routePaths([WALK_QUERY]);

    expect(paths.size).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  /**
   * Recette BUG-003 : le service décide seul de renoncer, et de reprendre.
   *
   * Le Service Itinéraire ne conditionne plus l'appel à l'état de la source TC
   * — un `plan` GTFS lent ne dit rien du réseau piéton. C'est donc ici que la
   * latence est protégée quand le moteur est réellement arrêté.
   */
  describe('coupe-circuit du moteur (BUG-003)', () => {
    beforeEach(() => {
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    });

    it('cesse d’interroger un moteur qui s’est tu sur toute une rafale (C10)', async () => {
      query.mockRejectedValue(new OtpUnavailableError('network', 'OTP injoignable.'));

      await service.routePaths([WALK_QUERY]);
      // Une demande **différente** : le silence n'est pas mémorisé dans le
      // cache des cheminements, c'est bien le circuit qui l'écarte.
      await service.routePaths([{ ...WALK_QUERY, mode: TransportMode.BIKE }]);

      expect(query).toHaveBeenCalledTimes(1);
    });

    it('rouvre le circuit une fois le délai écoulé, sans purge ni redémarrage', async () => {
      query.mockRejectedValue(new OtpUnavailableError('network', 'OTP injoignable.'));
      await service.routePaths([WALK_QUERY]);

      // Le moteur est revenu, et la minute est passée.
      query.mockResolvedValue(planWith(WALK_POINTS));
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);

      const paths = await service.routePaths([WALK_QUERY]);

      expect(paths.has(streetPathKey(WALK_QUERY))).toBe(true);
      jest.spyOn(Date, 'now').mockRestore();
    });

    it('ne coupe rien quand une seule extrémité n’a pas de chemin', async () => {
      // Un cheminement peut échouer parce qu'il n'existe pas. En conclure que
      // le moteur est en panne priverait de tracé les segments routables des
      // recherches suivantes — le défaut même que ce ticket corrige.
      query
        .mockRejectedValueOnce(new OtpUnavailableError('network', 'OTP injoignable.'))
        .mockResolvedValue(planWith(WALK_POINTS));

      await service.routePaths([WALK_QUERY, { ...WALK_QUERY, mode: TransportMode.BIKE }]);
      await service.routePaths([{ ...WALK_QUERY, mode: TransportMode.SCOOTER }]);

      expect(query).toHaveBeenCalledTimes(3);
    });
  });

  it("n'envoie ni date ni heure : un trottoir est le même à 8 h et à 22 h", async () => {
    await service.routePaths([WALK_QUERY]);

    const [, variables] = query.mock.calls[0];
    expect(variables).not.toHaveProperty('date');
    expect(variables).not.toHaveProperty('time');
  });

  describe('streetPathKey', () => {
    it('distingue deux modes, deux sens et deux exigences PMR', () => {
      const base = streetPathKey(WALK_QUERY);

      expect(streetPathKey({ ...WALK_QUERY, mode: TransportMode.BIKE })).not.toBe(base);
      expect(streetPathKey({ ...WALK_QUERY, wheelchair: true })).not.toBe(base);
      expect(streetPathKey({ ...WALK_QUERY, from: NEARBY, to: PART_DIEU })).not.toBe(base);
    });

    it('confond deux coordonnées identiques au mètre près, pour que le cache serve', () => {
      // Même point, écrit avec le bruit d'un calcul flottant : c'est la même
      // borne Vélo'v, et lui redemander son cheminement serait un aller-retour
      // pour rien (C5).
      expect(streetPathKey({ ...WALK_QUERY, from: { lat: 45.760500001, lng: 4.859060001 } })).toBe(
        streetPathKey({ ...WALK_QUERY, from: { lat: 45.7605, lng: 4.85906 } }),
      );
    });
  });
});
