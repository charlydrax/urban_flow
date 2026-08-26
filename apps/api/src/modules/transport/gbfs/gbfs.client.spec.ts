import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { GbfsClient, GbfsUnavailableError } from './gbfs.client';

/**
 * Recette UF-303 — « une indisponibilité du flux GBFS ne fait pas planter le
 * service » et « prévoir une petite mise en cache ».
 *
 * Le client est testé contre un `fetch` simulé : aucun accès au flux réel n'est
 * nécessaire, ce qui rend ces tests exécutables en CI et insensibles à l'état
 * du réseau de l'opérateur.
 */

const DISCOVERY_URL = 'https://gbfs.test/velov/gbfs.json';
const STATUS_URL = 'https://gbfs.test/velov/station_status.json';
const INFORMATION_URL = 'https://gbfs.test/velov/station_information.json';
const VEHICLE_TYPES_URL = 'https://gbfs.test/velov/vehicle_types.json';

/** Configuration minimale : TTL court pour observer l'expiration sans attendre. */
const CONFIG = {
  GBFS_DISCOVERY_URL: DISCOVERY_URL,
  GBFS_TIMEOUT_MS: 2000,
  GBFS_STATUS_TTL_MS: 60_000,
} as Record<string, unknown>;

/** Erreur telle que la lève `AbortSignal.timeout` : un DOMException `TimeoutError`. */
function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

/** Réponse `fetch` simulée. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

/** Document d'auto-découverte GBFS 2.x (`data` indexé par langue). */
function discoveryV2(): unknown {
  return {
    last_updated: 1_787_736_726,
    ttl: 3600,
    version: '2.3',
    data: {
      fr: {
        feeds: [
          { name: 'station_information', url: INFORMATION_URL },
          { name: 'station_status', url: STATUS_URL },
          { name: 'vehicle_types', url: VEHICLE_TYPES_URL },
        ],
      },
    },
  };
}

/** Flux `station_status` minimal. */
function statusFeed(lastUpdated = 1_787_738_075): unknown {
  return {
    last_updated: lastUpdated,
    ttl: 1,
    version: '2.3',
    data: { stations: [{ station_id: '3080', num_bikes_available: 5 }] },
  };
}

describe('GbfsClient', () => {
  let client: GbfsClient;
  let fetchMock: jest.Mock;

  /** Répond selon l'URL demandée — l'ordre des appels n'a donc pas d'importance. */
  function respondByUrl(overrides: Record<string, unknown> = {}): void {
    fetchMock.mockImplementation((url: string) => {
      const bodies: Record<string, unknown> = {
        [DISCOVERY_URL]: discoveryV2(),
        [STATUS_URL]: statusFeed(),
        [INFORMATION_URL]: {
          last_updated: 1_787_738_075,
          data: { stations: [{ station_id: '3080', name: 'PART-DIEU', lat: 45.76, lon: 4.86 }] },
        },
        [VEHICLE_TYPES_URL]: {
          last_updated: 1_787_736_731,
          data: {
            vehicle_types: [
              { vehicle_type_id: 'mechanical', form_factor: 'bicycle', propulsion_type: 'human' },
            ],
          },
        },
        ...overrides,
      };
      return Promise.resolve(jsonResponse(bodies[url]));
    });
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GbfsClient,
        {
          provide: ConfigService,
          useValue: { get: (key: string, fallback: unknown) => CONFIG[key] ?? fallback },
        },
      ],
    }).compile();

    client = moduleRef.get(GbfsClient);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('découvre les URL des flux au lieu de les écrire en dur (C9)', async () => {
    respondByUrl();

    await client.getStationStatus();

    const requested = fetchMock.mock.calls.map(([url]) => url as string);
    expect(requested).toEqual([DISCOVERY_URL, STATUS_URL]);
  });

  it('accepte aussi un document d’auto-découverte GBFS 3.x (`feeds` sans niveau langue)', async () => {
    respondByUrl({
      [DISCOVERY_URL]: {
        last_updated: 1_787_736_726,
        version: '3.0',
        data: { feeds: [{ name: 'station_status', url: STATUS_URL }] },
      },
    });

    const status = await client.getStationStatus();

    expect(status.stations).toHaveLength(1);
  });

  it('expose la publication du flux en ISO 8601 — la fraîcheur de la donnée', async () => {
    respondByUrl();

    const status = await client.getStationStatus();

    expect(status.publishedAt).toBe(new Date(1_787_738_075 * 1000).toISOString());
  });

  it('borne chaque requête dans le temps (C10)', async () => {
    respondByUrl();

    await client.getStationStatus();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('mémoïse le statut le temps de son TTL : deux lectures, une seule requête (C5)', async () => {
    respondByUrl();

    await client.getStationStatus();
    await client.getStationStatus();

    // Auto-découverte + statut, et rien de plus au second appel.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('dédoublonne les requêtes concurrentes sur un même flux (C5)', async () => {
    respondByUrl();

    await Promise.all([client.getStationStatus(), client.getStationStatus()]);

    expect(fetchMock.mock.calls.filter(([url]) => url === STATUS_URL)).toHaveLength(1);
  });

  it('contourne le cache pour la sonde de santé — un état mémoïsé n’est plus un état', async () => {
    respondByUrl();

    await client.getStationStatus();
    await client.probe();

    expect(fetchMock.mock.calls.filter(([url]) => url === STATUS_URL)).toHaveLength(2);
  });

  it('ne mémoïse jamais un échec : la source est réessayée au coup suivant', async () => {
    respondByUrl();
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(client.getStationStatus()).rejects.toBeInstanceOf(GbfsUnavailableError);
    await expect(client.getStationStatus()).resolves.toMatchObject({
      stations: [{ station_id: '3080' }],
    });
  });

  it('qualifie un dépassement de délai en `timeout`', async () => {
    respondByUrl();
    fetchMock.mockRejectedValueOnce(timeoutError());

    await expect(client.getStationStatus()).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('qualifie un flux injoignable en `network`', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(client.getStationStatus()).rejects.toMatchObject({ reason: 'network' });
  });

  it('qualifie une réponse HTTP en erreur en `upstream-error`', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));

    await expect(client.getStationStatus()).rejects.toMatchObject({ reason: 'upstream-error' });
  });

  it('refuse un corps qui n’est pas un objet JSON (page d’erreur servie en 200)', async () => {
    fetchMock.mockResolvedValue(jsonResponse('<html>maintenance</html>'));

    await expect(client.getStationStatus()).rejects.toMatchObject({ reason: 'upstream-error' });
  });

  it('refuse un document d’auto-découverte qui ne déclare aucun flux', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ last_updated: 1, data: {} }));

    await expect(client.getStationStatus()).rejects.toMatchObject({ reason: 'upstream-error' });
  });

  it('signale le flux manquant quand l’opérateur ne le publie pas', async () => {
    respondByUrl({
      [DISCOVERY_URL]: {
        last_updated: 1,
        data: { fr: { feeds: [{ name: 'station_information', url: INFORMATION_URL }] } },
      },
    });

    await expect(client.getStationStatus()).rejects.toMatchObject({ reason: 'upstream-error' });
  });

  it('traite l’absence du flux `vehicle_types` comme normale, pas comme une panne', async () => {
    respondByUrl({
      [DISCOVERY_URL]: {
        last_updated: 1,
        data: { fr: { feeds: [{ name: 'station_status', url: STATUS_URL }] } },
      },
    });

    await expect(client.getVehicleTypes()).resolves.toEqual([]);
  });

  it('rend la sonde exploitable même quand l’opérateur est injoignable (C10)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(client.probe()).resolves.toEqual({
      reachable: false,
      publishedAt: null,
      stationCount: 0,
      reason: 'network',
    });
  });

  it('rend la fraîcheur et le volume du flux quand l’opérateur répond', async () => {
    respondByUrl();

    await expect(client.probe()).resolves.toMatchObject({ reachable: true, stationCount: 1 });
  });
});
