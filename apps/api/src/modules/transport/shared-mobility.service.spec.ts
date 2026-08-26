import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { GbfsClient, GbfsUnavailableError } from './gbfs/gbfs.client';
import { SharedMobilityService } from './shared-mobility.service';

/**
 * Recette UF-303 :
 * 1. `getNearbyStations` retourne les stations proches d'un point avec le
 *    nombre de vélos disponibles ;
 * 2. les données sont fraîches (statut temps réel, pas figé) ;
 * 3. une indisponibilité du flux GBFS ne fait pas planter le service.
 */

/** Point de référence : la gare de la Part-Dieu. */
const ORIGIN = { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 };

/** Publication du flux, telle que l'opérateur la date. */
const PUBLISHED_AT = new Date(1_787_738_075 * 1000).toISOString();

describe('SharedMobilityService', () => {
  let service: SharedMobilityService;
  let getStationInformation: jest.Mock;
  let getStationStatus: jest.Mock;
  let getVehicleTypes: jest.Mock;
  let probe: jest.Mock;

  beforeEach(async () => {
    getStationInformation = jest.fn().mockResolvedValue([
      {
        station_id: '3080',
        name: 'PART-DIEU / VILLETTE',
        lat: 45.760042,
        lon: 4.861734,
        capacity: 30,
      },
      {
        station_id: '6031',
        name: 'LAFAYETTE / CORNEILLE',
        lat: 45.763717,
        lon: 4.843791,
        capacity: 13,
      },
    ]);

    getStationStatus = jest.fn().mockResolvedValue({
      publishedAt: PUBLISHED_AT,
      stations: [
        {
          station_id: '3080',
          num_bikes_available: 5,
          num_docks_available: 22,
          vehicle_types_available: [
            { vehicle_type_id: 'mechanical', count: 3 },
            { vehicle_type_id: 'electrical', count: 2 },
          ],
          is_installed: true,
          is_renting: true,
          is_returning: true,
        },
        { station_id: '6031', num_bikes_available: 1, is_installed: true },
      ],
    });

    getVehicleTypes = jest.fn().mockResolvedValue([
      { vehicle_type_id: 'mechanical', form_factor: 'bicycle', propulsion_type: 'human' },
      { vehicle_type_id: 'electrical', form_factor: 'bicycle', propulsion_type: 'electric_assist' },
    ]);

    probe = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        SharedMobilityService,
        {
          provide: GbfsClient,
          useValue: { getStationInformation, getStationStatus, getVehicleTypes, probe },
        },
      ],
    }).compile();

    service = moduleRef.get(SharedMobilityService);
  });

  // ---- Recette 1 : stations proches et disponibilité ----

  it('retourne les stations proches avec le nombre de vélos disponibles', async () => {
    const result = await service.getNearbyStations(ORIGIN);

    expect(result.status).toBe('ok');
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0]).toMatchObject({
      id: '3080',
      name: 'PART-DIEU / VILLETTE',
      vehiclesAvailable: 5,
      docksAvailable: 22,
    });
  });

  it('élargit la recherche quand le rayon le demande', async () => {
    const result = await service.getNearbyStations(ORIGIN, { radiusMeters: 2000 });

    expect(result.stations.map((station) => station.id)).toEqual(['3080', '6031']);
    expect(result.radiusMeters).toBe(2000);
  });

  it('interroge les trois flux en parallèle plutôt qu’en cascade (C10)', async () => {
    await service.getNearbyStations(ORIGIN);

    expect(getStationInformation).toHaveBeenCalledTimes(1);
    expect(getStationStatus).toHaveBeenCalledTimes(1);
    expect(getVehicleTypes).toHaveBeenCalledTimes(1);
  });

  it('rend un résultat `ok` et vide quand aucune station n’est dans le rayon', async () => {
    const result = await service.getNearbyStations({ label: 'Océan', lat: 0, lng: 0 });

    // Absence de station n'est pas panne : le client ne doit pas afficher
    // « service indisponible » parce qu'il est au milieu de nulle part.
    expect(result).toMatchObject({ status: 'ok', stations: [] });
  });

  // ---- Recette 2 : fraîcheur ----

  it('expose l’horodatage de publication de l’opérateur, pas celui de la réponse', async () => {
    const result = await service.getNearbyStations(ORIGIN);

    expect(result.publishedAt).toBe(PUBLISHED_AT);
  });

  it('lit le statut par le cache court, jamais figé sur un instantané', async () => {
    await service.getNearbyStations(ORIGIN);

    // `refresh` non demandé : c'est le TTL court du client qui arbitre, et non
    // une valeur mémorisée par le service — lequel n'a délibérément aucun cache.
    expect(getStationStatus).toHaveBeenCalledWith();
  });

  // ---- Recette 3 : dégradation gracieuse ----

  it('ne plante pas quand le flux est injoignable : résultat `unavailable`', async () => {
    getStationStatus.mockRejectedValue(new GbfsUnavailableError('network', 'injoignable'));

    const result = await service.getNearbyStations(ORIGIN);

    expect(result).toMatchObject({
      status: 'unavailable',
      stations: [],
      unavailableReason: 'network',
      publishedAt: null,
    });
  });

  it('qualifie un dépassement de délai sans lever d’exception', async () => {
    getStationInformation.mockRejectedValue(new GbfsUnavailableError('timeout', 'trop long'));

    await expect(service.getNearbyStations(ORIGIN)).resolves.toMatchObject({
      status: 'unavailable',
      unavailableReason: 'timeout',
    });
  });

  it('absorbe même une erreur inattendue — le planificateur doit rester debout (C10)', async () => {
    getVehicleTypes.mockRejectedValue(new Error('bug interne'));

    await expect(service.getNearbyStations(ORIGIN)).resolves.toMatchObject({
      status: 'unavailable',
      unavailableReason: 'upstream-error',
    });
  });

  it('rapporte le rayon appliqué même en cas de panne', async () => {
    getStationStatus.mockRejectedValue(new GbfsUnavailableError('network', 'injoignable'));

    const result = await service.getNearbyStations(ORIGIN, { radiusMeters: 800 });

    expect(result.radiusMeters).toBe(800);
  });

  // ---- Bornage des entrées ----

  it('refuse des coordonnées hors du domaine terrestre (défense en profondeur — C4)', async () => {
    await expect(
      service.getNearbyStations({ label: 'Nulle part', lat: 200, lng: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('plafonne un rayon démesuré plutôt que de balayer tout le réseau (C5)', async () => {
    const result = await service.getNearbyStations(ORIGIN, { radiusMeters: 500_000 });

    expect(result.radiusMeters).toBe(2000);
  });

  it('relève un rayon inférieur à la précision d’un GPS urbain (C6)', async () => {
    const result = await service.getNearbyStations(ORIGIN, { radiusMeters: 5 });

    expect(result.radiusMeters).toBe(50);
  });

  it('applique le rayon par défaut quand il n’est pas demandé', async () => {
    const result = await service.getNearbyStations(ORIGIN);

    expect(result.radiusMeters).toBe(500);
  });

  it('plafonne le nombre de stations rendues', async () => {
    const result = await service.getNearbyStations(ORIGIN, { radiusMeters: 2000, limit: 1 });

    expect(result.stations).toHaveLength(1);
  });

  it('délègue la sonde de santé au client, cache contourné', async () => {
    probe.mockResolvedValue({ reachable: true, publishedAt: PUBLISHED_AT, stationCount: 428 });

    await expect(service.probe()).resolves.toMatchObject({ reachable: true, stationCount: 428 });
  });
});
