import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TransitEndpoint } from '@urbanflow/shared';

import { TransportMode } from '../../common/enums/transport-mode.enum';
import { OtpClient, OtpUnavailableError } from './otp/otp.client';
import type { OtpPlanData } from './otp/otp.types';
import { TransitService } from './transit.service';

/**
 * Recette UF-302 :
 * - `getTransitJourneys` retourne des trajets structurés pour un couple valide ;
 * - la réponse est normalisée au format interne (indépendant d'OTP) ;
 * - un timeout est capté et remonté proprement, sans crash.
 */

/** Les deux pôles du scénario de référence (CLAUDE.md — le trajet de « Marie »). */
const PART_DIEU: TransitEndpoint = { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 };
const BELLECOUR: TransitEndpoint = { label: 'Bellecour', lat: 45.757813, lng: 4.832011 };

/** Période couverte par le miroir GTFS de développement : 14/04 → 13/07/2022. */
const SERVICE_WINDOW = { start: 1649887200, end: 1657663200 };

/** Réponse OTP minimale : marche puis bus C9. */
const PLAN_RESPONSE: OtpPlanData = {
  plan: {
    itineraries: [
      {
        duration: 1092,
        startTime: 1652769134000,
        endTime: 1652770226000,
        walkDistance: 522.04,
        legs: [
          {
            mode: 'WALK',
            startTime: 1652769134000,
            endTime: 1652769300000,
            duration: 166,
            distance: 214.03,
            transitLeg: false,
            legGeometry: { points: 'arhvGe`t\\?@BHN^' },
            route: null,
            trip: null,
            from: { name: 'Origin', lat: 45.760515, lon: 4.859057, stop: null },
            to: {
              name: 'Gare Part-Dieu V.Merle',
              lat: 45.760837,
              lon: 4.857902,
              stop: { gtfsId: 'tcl:46088', wheelchairBoarding: 'POSSIBLE' },
            },
          },
          {
            mode: 'BUS',
            startTime: 1652769300000,
            endTime: 1652769960000,
            duration: 660,
            distance: 2169.76,
            transitLeg: true,
            headsign: 'Bellecour Le Viste',
            legGeometry: { points: 'ethvG{xs\\j@zg@' },
            route: { shortName: 'C9', longName: null, agency: { name: 'TCL SYTRAL' } },
            trip: { tripHeadsign: 'Bellecour Le Viste', wheelchairAccessible: 'POSSIBLE' },
            from: {
              name: 'Gare Part-Dieu V.Merle',
              lat: 45.760837,
              lon: 4.857902,
              stop: { gtfsId: 'tcl:46088', wheelchairBoarding: 'POSSIBLE' },
            },
            to: {
              name: 'Bellecour Le Viste',
              lat: 45.7575919,
              lon: 4.8338879,
              stop: { gtfsId: 'tcl:12289', wheelchairBoarding: 'POSSIBLE' },
            },
          },
        ],
      },
    ],
  },
};

describe('TransitService', () => {
  let service: TransitService;
  let otp: { query: jest.Mock; getServiceWindow: jest.Mock; endpoint: string };

  beforeEach(async () => {
    otp = {
      query: jest.fn().mockResolvedValue(PLAN_RESPONSE),
      getServiceWindow: jest.fn().mockResolvedValue(SERVICE_WINDOW),
      endpoint: 'http://otp.test:8080/otp/gtfs/v1',
    };

    const moduleRef = await Test.createTestingModule({
      providers: [TransitService, { provide: OtpClient, useValue: otp }],
    }).compile();

    service = moduleRef.get(TransitService);
  });

  describe('trajets pour un couple départ/arrivée valide', () => {
    it('retourne des trajets structurés au format interne', async () => {
      const result = await service.getTransitJourneys(PART_DIEU, BELLECOUR, {
        departureAt: '2022-05-17T08:30:00+02:00',
      });

      expect(result.status).toBe('ok');
      expect(result.journeys).toHaveLength(1);

      const [journey] = result.journeys;
      expect(journey.id).toBe('transit-1');
      expect(journey.durationMinutes).toBe(18);
      expect(journey.transfers).toBe(0);
      expect(journey.accessible).toBe(true);
      expect(journey.legs.map((leg) => leg.mode)).toEqual([TransportMode.WALK, TransportMode.BUS]);
      expect(journey.legs[1].line).toBe('C9');
      expect(journey.geometry?.type).toBe('LineString');
    });

    it('ne laisse fuiter aucune structure OTP dans le résultat', async () => {
      // Garde-fou du découplage : si un champ brut d'OTP (`lon`, `legGeometry`,
      // `transitLeg` en millisecondes…) réapparaissait, le Service Itinéraire
      // deviendrait dépendant du moteur de routage.
      const result = await service.getTransitJourneys(PART_DIEU, BELLECOUR);
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain('"lon"');
      expect(serialized).not.toContain('legGeometry');
      expect(serialized).not.toContain('walkDistance"');
      expect(serialized).not.toContain('tripHeadsign');
    });

    it('interroge OTP en heure locale du réseau, à la date demandée', async () => {
      await service.getTransitJourneys(PART_DIEU, BELLECOUR, {
        departureAt: '2022-05-17T08:30:00+02:00',
      });

      const variables = otp.query.mock.calls[0][1] as Record<string, unknown>;
      expect(variables.date).toBe('2022-05-17');
      expect(variables.time).toBe('08:30:00');
      // OTP attend `lon`, le contrat interne parle de `lng` : la traduction se
      // fait ici et nulle part ailleurs.
      expect(variables.from).toEqual({ lat: 45.760515, lon: 4.859057 });
    });

    it('borne le nombre de trajets demandés au moteur (C5)', async () => {
      await service.getTransitJourneys(PART_DIEU, BELLECOUR, { maxResults: 99 });
      expect((otp.query.mock.calls[0][1] as { numItineraries: number }).numItineraries).toBe(6);

      await service.getTransitJourneys(PART_DIEU, BELLECOUR);
      expect((otp.query.mock.calls[1][1] as { numItineraries: number }).numItineraries).toBe(3);
    });

    it('transmet la demande d’itinéraire accessible en fauteuil (C12)', async () => {
      await service.getTransitJourneys(PART_DIEU, BELLECOUR, { wheelchair: true });

      expect((otp.query.mock.calls[0][1] as { wheelchair: boolean }).wheelchair).toBe(true);
    });

    it('rend une liste vide sans erreur quand aucun trajet n’existe', async () => {
      otp.query.mockResolvedValue({ plan: { itineraries: [] } });

      const result = await service.getTransitJourneys(PART_DIEU, BELLECOUR);

      // Répondre « aucun trajet » n'est pas une panne : le statut reste `ok`.
      expect(result).toMatchObject({ status: 'ok', journeys: [] });
    });
  });

  describe('recalage de la date sur la période couverte par le graphe', () => {
    it('recale une date hors période et le signale', async () => {
      const result = await service.getTransitJourneys(PART_DIEU, BELLECOUR, {
        departureAt: '2026-08-26T08:30:00+02:00',
      });

      expect(result.requestedDate).toBe('2026-08-26');
      expect(result.dateAdjusted).toBe(true);
      expect(result.serviceDate).not.toBe('2026-08-26');
      // La date réellement interrogée est celle transmise au moteur.
      expect((otp.query.mock.calls[0][1] as { date: string }).date).toBe(result.serviceDate);
    });

    it('laisse la date intacte quand elle est couverte', async () => {
      const result = await service.getTransitJourneys(PART_DIEU, BELLECOUR, {
        departureAt: '2022-05-17T08:30:00+02:00',
      });

      expect(result).toMatchObject({
        requestedDate: '2022-05-17',
        serviceDate: '2022-05-17',
        dateAdjusted: false,
      });
    });
  });

  describe('dégradation gracieuse (C10)', () => {
    it('capte un timeout et le remonte proprement, sans lever d’exception', async () => {
      otp.query.mockRejectedValue(
        new OtpUnavailableError('timeout', "OpenTripPlanner n'a pas répondu à temps."),
      );

      const result = await service.getTransitJourneys(PART_DIEU, BELLECOUR);

      expect(result).toMatchObject({
        status: 'unavailable',
        unavailableReason: 'timeout',
        journeys: [],
      });
    });

    it('capte un moteur injoignable', async () => {
      otp.getServiceWindow.mockRejectedValue(
        new OtpUnavailableError('network', 'OpenTripPlanner est injoignable.'),
      );

      const result = await service.getTransitJourneys(PART_DIEU, BELLECOUR);

      expect(result).toMatchObject({ status: 'unavailable', unavailableReason: 'network' });
    });

    it('rapporte tout de même la date réellement visée', async () => {
      // Sans cela, un timeout ferait croire que la recherche portait sur la date
      // du jour, alors que le graphe avait été interrogé sur une autre journée.
      otp.query.mockRejectedValue(new OtpUnavailableError('timeout', 'trop long'));

      const result = await service.getTransitJourneys(PART_DIEU, BELLECOUR, {
        departureAt: '2026-08-26T08:30:00+02:00',
      });

      expect(result.dateAdjusted).toBe(true);
      expect(result.serviceDate).not.toBe('2026-08-26');
    });

    it('absorbe même une erreur inattendue plutôt que de casser le planificateur', async () => {
      otp.query.mockRejectedValue(new Error('boom'));

      const result = await service.getTransitJourneys(PART_DIEU, BELLECOUR);

      expect(result).toMatchObject({ status: 'unavailable', unavailableReason: 'upstream-error' });
    });
  });

  describe('validation des entrées (C4)', () => {
    it('refuse des coordonnées hors du domaine terrestre', async () => {
      await expect(
        service.getTransitJourneys({ label: 'Nulle part', lat: 91, lng: 0 }, BELLECOUR),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(otp.query).not.toHaveBeenCalled();
    });

    it('refuse un instant de départ illisible', async () => {
      await expect(
        service.getTransitJourneys(PART_DIEU, BELLECOUR, { departureAt: 'pas-une-date' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('probe', () => {
    it('rapporte la période couverte quand le moteur répond', async () => {
      await expect(service.probe()).resolves.toEqual({
        reachable: true,
        serviceWindow: {
          from: new Date(SERVICE_WINDOW.start * 1000).toISOString(),
          to: new Date(SERVICE_WINDOW.end * 1000).toISOString(),
        },
      });
    });

    it('contourne le cache pour refléter l’état courant du moteur', async () => {
      await service.probe();

      expect(otp.getServiceWindow).toHaveBeenCalledWith(true);
    });

    it('rapporte un moteur injoignable sans lever d’exception', async () => {
      otp.getServiceWindow.mockRejectedValue(new OtpUnavailableError('network', 'down'));

      await expect(service.probe()).resolves.toEqual({ reachable: false, serviceWindow: null });
    });
  });
});
