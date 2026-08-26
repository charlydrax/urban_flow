import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { OtpClient, OtpUnavailableError } from './otp.client';
import type { OtpServiceTimeRangeData } from './otp.types';

/**
 * Recette UF-302 — « un timeout OTP est capté et remonté proprement (pas de crash) ».
 *
 * Le client est testé contre un `fetch` simulé : aucun conteneur OpenTripPlanner
 * n'est nécessaire, ce qui rend ces tests exécutables en CI.
 */

/** Configuration minimale : URL locale et timeout court. */
const CONFIG = { OTP_BASE_URL: 'http://otp.test:8080', OTP_TIMEOUT_MS: 2000 } as Record<
  string,
  unknown
>;

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

describe('OtpClient', () => {
  let client: OtpClient;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpClient,
        {
          provide: ConfigService,
          useValue: { get: (key: string, fallback: unknown) => CONFIG[key] ?? fallback },
        },
      ],
    }).compile();

    client = moduleRef.get(OtpClient);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('cible l’API GraphQL du moteur de routage', () => {
    expect(client.endpoint).toBe('http://otp.test:8080/otp/gtfs/v1');
  });

  it('transmet les paramètres via `variables`, jamais concaténés dans le document (C4)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { ok: true } }));

    await client.query(
      'query Q($date: String!) { plan(date: $date) { id } }',
      { date: '2022-05-17' },
      'plan',
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(body.variables).toEqual({ date: '2022-05-17' });
    // La date ne doit apparaître nulle part dans le document lui-même.
    expect(body.query).not.toContain('2022-05-17');
  });

  it('borne la requête dans le temps', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));

    await client.query('{ ok }', {}, 'plan');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('qualifie un dépassement de délai en `timeout`', async () => {
    fetchMock.mockRejectedValue(timeoutError());

    await expect(client.query('{ ok }', {}, 'plan')).rejects.toMatchObject({
      name: 'OtpUnavailableError',
      reason: 'timeout',
    });
  });

  it('qualifie un moteur injoignable en `network`', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(client.query('{ ok }', {}, 'plan')).rejects.toMatchObject({ reason: 'network' });
  });

  it('qualifie une erreur HTTP en `upstream-error`', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));

    await expect(client.query('{ ok }', {}, 'plan')).rejects.toMatchObject({
      reason: 'upstream-error',
    });
  });

  it('détecte une erreur GraphQL renvoyée avec un statut 200', async () => {
    // GraphQL répond 200 même en cas d'erreur applicative : sans cette
    // vérification, une requête invalide passerait pour un succès vide.
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ message: 'Unknown field' }] }));

    await expect(client.query('{ ok }', {}, 'plan')).rejects.toMatchObject({
      reason: 'upstream-error',
    });
  });

  it('rejette un corps de réponse illisible', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as unknown as Response);

    await expect(client.query('{ ok }', {}, 'plan')).rejects.toBeInstanceOf(OtpUnavailableError);
  });

  describe('getServiceWindow', () => {
    const window: OtpServiceTimeRangeData = {
      serviceTimeRange: { start: 1649887200, end: 1657663200 },
    };

    it('lit la période couverte par le graphe', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: window }));

      await expect(client.getServiceWindow()).resolves.toEqual({
        start: 1649887200,
        end: 1657663200,
      });
    });

    it('mémoïse la période : une seule requête pour plusieurs appels (C5)', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: window }));

      await client.getServiceWindow();
      await client.getServiceWindow();

      // La période ne change qu'à la reconstruction du graphe : la réinterroger
      // à chaque recherche serait une requête réseau inutile.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('réinterroge le moteur quand on demande explicitement un rafraîchissement', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: window }));

      await client.getServiceWindow();
      await client.getServiceWindow(true);

      // Sans cela, le contrôle de santé annoncerait un moteur « opérationnel »
      // jusqu'à une heure après son arrêt.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rend `null` quand le graphe ne déclare aucune période', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: { serviceTimeRange: null } }));

      await expect(client.getServiceWindow()).resolves.toBeNull();
    });
  });
});
