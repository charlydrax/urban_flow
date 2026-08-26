import { TransportMode } from '@urbanflow/shared';

import { toNearbyStations } from './gbfs.mapper';
import type { GbfsStationInformation, GbfsStationStatus, GbfsVehicleType } from './gbfs.types';

/**
 * Recette UF-303 — « getNearbyStations retourne les stations proches d'un point
 * avec le nombre de vélos dispo ».
 *
 * Le mapper est une fonction pure : ces cas s'exécutent sans réseau ni
 * conteneur. Les jeux d'essai reprennent la forme réelle du flux Vélo'v
 * (identifiants de type `mechanical` / `electrical`, GBFS 2.3).
 */

/** Point de référence : la gare de la Part-Dieu. */
const ORIGIN = { lat: 45.760515, lng: 4.859057 };

/** Catalogue tel que publié par Vélo'v. */
const VEHICLE_TYPES: GbfsVehicleType[] = [
  { vehicle_type_id: 'mechanical', form_factor: 'bicycle', propulsion_type: 'human' },
  { vehicle_type_id: 'electrical', form_factor: 'bicycle', propulsion_type: 'electric_assist' },
];

/** Station voisine du point de référence (≈ 150 m). */
const NEARBY: GbfsStationInformation = {
  station_id: '3080',
  name: 'PART-DIEU / VILLETTE',
  lat: 45.760042,
  lon: 4.861734,
  address: '55 RUE DE LA VILLETTE',
  capacity: 30,
};

/** Station bien plus loin, hors du rayon par défaut (≈ 1,2 km). */
const FAR_AWAY: GbfsStationInformation = {
  station_id: '6031',
  name: 'LAFAYETTE / CORNEILLE',
  lat: 45.763717,
  lon: 4.843791,
  capacity: 13,
};

/** État nominal de la station voisine : 5 vélos dont 2 électriques. */
const NEARBY_STATUS: GbfsStationStatus = {
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
  last_reported: 1_787_726_028,
};

/** Appel du mapper avec les valeurs par défaut du service. */
function map(
  information: GbfsStationInformation[],
  status: GbfsStationStatus[],
  overrides: { radiusMeters?: number; limit?: number; vehicleTypes?: GbfsVehicleType[] } = {},
) {
  return toNearbyStations({
    information,
    status,
    vehicleTypes: overrides.vehicleTypes ?? VEHICLE_TYPES,
    origin: ORIGIN,
    radiusMeters: overrides.radiusMeters ?? 500,
    limit: overrides.limit ?? 10,
  });
}

describe('toNearbyStations', () => {
  it('rend la station proche avec sa disponibilité, au format interne', () => {
    const [station] = map([NEARBY], [NEARBY_STATUS]);

    expect(station).toMatchObject({
      id: '3080',
      name: 'PART-DIEU / VILLETTE',
      address: '55 RUE DE LA VILLETTE',
      capacity: 30,
      vehiclesAvailable: 5,
      docksAvailable: 22,
      renting: true,
      returning: true,
    });
    expect(station.distanceMeters).toBeGreaterThan(100);
    expect(station.distanceMeters).toBeLessThan(250);
  });

  it('ventile la flotte par mode et par motorisation (C9)', () => {
    const [station] = map([NEARBY], [NEARBY_STATUS]);

    expect(station.vehicles).toEqual([
      { mode: TransportMode.BIKE, electric: false, count: 3 },
      { mode: TransportMode.BIKE, electric: true, count: 2 },
    ]);
  });

  it('convertit le dernier rapport de la station en ISO 8601', () => {
    const [station] = map([NEARBY], [NEARBY_STATUS]);

    expect(station.lastReportedAt).toBe(new Date(1_787_726_028 * 1000).toISOString());
  });

  it('écarte les stations hors du rayon demandé', () => {
    const stations = map(
      [NEARBY, FAR_AWAY],
      [NEARBY_STATUS, { ...NEARBY_STATUS, station_id: '6031' }],
    );

    expect(stations.map((station) => station.id)).toEqual(['3080']);
  });

  it('trie par distance croissante, sur tout le rayon et non sur l’ordre du flux', () => {
    const stations = map(
      [FAR_AWAY, NEARBY],
      [{ ...NEARBY_STATUS, station_id: '6031' }, NEARBY_STATUS],
      { radiusMeters: 2000 },
    );

    expect(stations.map((station) => station.id)).toEqual(['3080', '6031']);
  });

  it('respecte la limite après le tri, pas avant', () => {
    const stations = map(
      [FAR_AWAY, NEARBY],
      [{ ...NEARBY_STATUS, station_id: '6031' }, NEARBY_STATUS],
      { radiusMeters: 2000, limit: 1 },
    );

    expect(stations).toHaveLength(1);
    expect(stations[0].id).toBe('3080');
  });

  it('écarte une borne non déployée (`is_installed: false`)', () => {
    const stations = map([NEARBY], [{ ...NEARBY_STATUS, is_installed: false }]);

    expect(stations).toEqual([]);
  });

  it('écarte une station dont l’état n’est pas publié — plutôt que de l’annoncer à zéro', () => {
    expect(map([NEARBY], [])).toEqual([]);
  });

  it('conserve une station installée qui ne loue plus, avec `renting: false`', () => {
    const [station] = map([NEARBY], [{ ...NEARBY_STATUS, is_renting: false }]);

    expect(station).toMatchObject({ id: '3080', renting: false, returning: true });
  });

  it('considère qu’un drapeau absent vaut « en service » (défaut de la spécification)', () => {
    const [station] = map([NEARBY], [{ station_id: '3080', num_bikes_available: 1 }]);

    expect(station).toMatchObject({ renting: true, returning: true, vehiclesAvailable: 1 });
  });

  it('rend `null` pour les compteurs que l’opérateur ne publie pas', () => {
    const [station] = map([{ ...NEARBY, capacity: undefined }], [{ station_id: '3080' }]);

    expect(station).toMatchObject({ capacity: null, docksAvailable: null, lastReportedAt: null });
  });

  it('écarte les types de véhicules hors mobilité douce (voiture, cyclomoteur)', () => {
    const [station] = map([NEARBY], [{ ...NEARBY_STATUS, num_bikes_available: 6 }], {
      vehicleTypes: [
        ...VEHICLE_TYPES,
        { vehicle_type_id: 'moped', form_factor: 'moped', propulsion_type: 'electric' },
      ],
    });

    // Le total publié par l'opérateur fait foi ; seule la ventilation ignore
    // les types dont le mode ne nous est pas connu.
    expect(station.vehiclesAvailable).toBe(6);
    expect(station.vehicles.every((vehicle) => vehicle.mode === TransportMode.BIKE)).toBe(true);
  });

  it('projette une trottinette sur le mode SCOOTER', () => {
    const [station] = map(
      [NEARBY],
      [
        {
          station_id: '3080',
          num_bikes_available: 4,
          vehicle_types_available: [{ vehicle_type_id: 'kick', count: 4 }],
        },
      ],
      {
        vehicleTypes: [
          { vehicle_type_id: 'kick', form_factor: 'scooter', propulsion_type: 'electric' },
        ],
      },
    );

    expect(station.vehicles).toEqual([{ mode: TransportMode.SCOOTER, electric: true, count: 4 }]);
  });

  it('additionne deux identifiants d’opérateur qui retombent sur la même catégorie', () => {
    const [station] = map(
      [NEARBY],
      [
        {
          station_id: '3080',
          num_bikes_available: 5,
          vehicle_types_available: [
            { vehicle_type_id: 'bike_v1', count: 2 },
            { vehicle_type_id: 'bike_v2', count: 3 },
          ],
        },
      ],
      {
        vehicleTypes: [
          { vehicle_type_id: 'bike_v1', form_factor: 'bicycle', propulsion_type: 'human' },
          { vehicle_type_id: 'bike_v2', form_factor: 'bicycle', propulsion_type: 'human' },
        ],
      },
    );

    expect(station.vehicles).toEqual([{ mode: TransportMode.BIKE, electric: false, count: 5 }]);
  });

  it('se replie sur la ventilation quand le total n’est pas publié', () => {
    const [station] = map(
      [NEARBY],
      [
        {
          station_id: '3080',
          vehicle_types_available: [
            { vehicle_type_id: 'mechanical', count: 2 },
            { vehicle_type_id: 'electrical', count: 1 },
          ],
        },
      ],
    );

    expect(station.vehiclesAvailable).toBe(3);
  });

  it('laisse la ventilation vide quand l’opérateur ne publie pas son catalogue', () => {
    const [station] = map([NEARBY], [NEARBY_STATUS], { vehicleTypes: [] });

    // Le total reste exact : c'est le détail par catégorie qui manque, et un
    // tableau vide le dit sans rien inventer.
    expect(station.vehiclesAvailable).toBe(5);
    expect(station.vehicles).toEqual([]);
  });

  it('écarte une station aux coordonnées inexploitables', () => {
    const stations = map([{ ...NEARBY, lat: Number.NaN }], [NEARBY_STATUS]);

    expect(stations).toEqual([]);
  });
});
