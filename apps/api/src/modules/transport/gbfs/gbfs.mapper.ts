import {
  TransportMode,
  type SharedMobilityStation,
  type SharedVehicleAvailability,
} from '@urbanflow/shared';

import { distanceMeters, type LatLng } from './distance';
import type { GbfsStationInformation, GbfsStationStatus, GbfsVehicleType } from './gbfs.types';

/**
 * Traduction des flux GBFS bruts vers les contrats internes (UF-303).
 *
 * **Fonctions pures**, sans dépendance à Nest ni au réseau : c'est ce qui rend
 * la correspondance testable sans conteneur ni flux en ligne, et ce qui permet
 * de remplacer l'opérateur sans toucher au service.
 *
 * Aucune structure GBFS ne franchit ce fichier : au-delà, l'application ne
 * connaît que `SharedMobilityStation`.
 */

/**
 * Correspondance `form_factor` GBFS → mode interne (C9).
 *
 * Un facteur de forme inconnu (`moped`, `car`, `other`) rend `null` et le type
 * est **écarté** : mêmes raisons que pour les modes OTP inconnus — annoncer un
 * scooter thermique comme une mobilité douce fausserait le calcul carbone, qui
 * est la proposition de valeur du produit.
 */
function toTransportMode(formFactor: string | undefined): TransportMode | null {
  switch (formFactor) {
    case 'bicycle':
    case 'cargo_bicycle':
      return TransportMode.BIKE;
    case 'scooter':
    case 'scooter_standing':
    case 'scooter_seated':
      return TransportMode.SCOOTER;
    default:
      return null;
  }
}

/** Un véhicule est « électrique » s'il porte une assistance ou une motorisation. */
function isElectric(propulsionType: string | undefined): boolean {
  return propulsionType === 'electric_assist' || propulsionType === 'electric';
}

/** Catégorie interne d'un type de véhicule GBFS, après projection. */
interface VehicleCategory {
  mode: TransportMode;
  electric: boolean;
}

/**
 * Indexe le catalogue des véhicules par identifiant d'opérateur.
 * Les types de facteur de forme inconnu sont absents de l'index : ils seront
 * ignorés lors de la ventilation.
 */
export function indexVehicleTypes(types: GbfsVehicleType[]): Map<string, VehicleCategory> {
  const index = new Map<string, VehicleCategory>();

  for (const type of types) {
    const mode = toTransportMode(type.form_factor);
    if (!mode || !type.vehicle_type_id) continue;

    index.set(type.vehicle_type_id, { mode, electric: isElectric(type.propulsion_type) });
  }
  return index;
}

/**
 * Ventile les véhicules disponibles d'une station par mode et motorisation.
 *
 * Les catégories vides sont omises : elles n'apprendraient rien de plus que le
 * total déjà porté par `vehiclesAvailable`, et chaque objet de trop est un objet
 * transporté sur un réseau mobile (C5). Plusieurs identifiants d'opérateur qui
 * retombent sur la même catégorie sont additionnés.
 */
function toVehicleAvailability(
  status: GbfsStationStatus,
  vehicleTypes: Map<string, VehicleCategory>,
): SharedVehicleAvailability[] {
  const counts = new Map<string, SharedVehicleAvailability>();

  for (const entry of status.vehicle_types_available ?? []) {
    const category = vehicleTypes.get(entry.vehicle_type_id);
    if (!category || !Number.isFinite(entry.count) || entry.count <= 0) continue;

    const key = `${category.mode}:${category.electric}`;
    const existing = counts.get(key);

    if (existing) {
      existing.count += entry.count;
    } else {
      counts.set(key, { ...category, count: entry.count });
    }
  }
  return [...counts.values()];
}

/**
 * Total des véhicules louables à une station.
 *
 * `num_bikes_available` fait foi quand il est publié : c'est le champ que
 * l'opérateur garantit, et il compte aussi les véhicules dont le type ne nous
 * est pas connu. La ventilation ne sert de repli que s'il est absent.
 */
function toTotalAvailable(status: GbfsStationStatus): number {
  if (Number.isFinite(status.num_bikes_available)) {
    return Math.max(0, status.num_bikes_available as number);
  }

  const sum = (status.vehicle_types_available ?? []).reduce(
    (total, entry) => total + (Number.isFinite(entry.count) ? entry.count : 0),
    0,
  );
  return Math.max(0, sum);
}

/** Rend un entier positif, ou `null` si l'opérateur ne publie pas la valeur. */
function toOptionalCount(value: number | undefined): number | null {
  return Number.isFinite(value) ? Math.max(0, value as number) : null;
}

/** Convertit des secondes epoch en ISO 8601, `null` si absent ou absurde. */
function toIsoDate(seconds: number | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

/** Vérifie qu'une station porte des coordonnées exploitables. */
function hasUsableCoordinates(station: GbfsStationInformation): boolean {
  return (
    Number.isFinite(station.lat) &&
    Number.isFinite(station.lon) &&
    Math.abs(station.lat) <= 90 &&
    Math.abs(station.lon) <= 180
  );
}

/** Entrées de la projection : les trois flux, le point visé et le bornage. */
export interface NearbyStationsInput {
  /** Flux `station_information` : position, nom, capacité. */
  information: GbfsStationInformation[];
  /** Flux `station_status` : disponibilité temps réel. */
  status: GbfsStationStatus[];
  /** Flux `vehicle_types` : facteur de forme et motorisation. Peut être vide. */
  vehicleTypes: GbfsVehicleType[];
  /** Point autour duquel chercher. */
  origin: LatLng;
  /** Rayon de recherche en mètres, déjà borné par l'appelant. */
  radiusMeters: number;
  /** Nombre maximal de stations rendues, déjà borné par l'appelant. */
  limit: number;
}

/**
 * Croise description et état des stations, puis rend celles du rayon demandé,
 * triées par distance croissante.
 *
 * Deux familles de stations sont volontairement **écartées** :
 *
 * - celles dont l'état n'est pas publié — on ne peut rien affirmer de leur
 *   disponibilité, et les annoncer à zéro serait affirmer quelque chose de faux ;
 * - celles marquées `is_installed: false` — bornes évènementielles démontées ou
 *   pas encore déployées, qui existent dans le flux mais pas dans la rue.
 *
 * Une station installée mais qui ne loue plus (maintenance, rééquilibrage) est
 * en revanche **conservée**, avec `renting: false` : elle reste un point de
 * retour valable, et la masquer priverait l'usager d'une information exacte.
 *
 * @param input Les trois flux, le point de référence et les bornes appliquées
 * @returns Les stations proches au format interne, de la plus proche à la plus lointaine
 */
export function toNearbyStations(input: NearbyStationsInput): SharedMobilityStation[] {
  const vehicleTypes = indexVehicleTypes(input.vehicleTypes);

  // Index par identifiant plutôt que recherche linéaire : le flux lyonnais
  // compte quelque 450 stations, un croisement naïf ferait 200 000 comparaisons
  // à chaque recherche (C5).
  const statusById = new Map(input.status.map((status) => [status.station_id, status]));

  const stations: SharedMobilityStation[] = [];

  for (const information of input.information) {
    if (!hasUsableCoordinates(information)) continue;

    const status = statusById.get(information.station_id);
    if (!status || status.is_installed === false) continue;

    const distance = distanceMeters(input.origin, {
      lat: information.lat,
      lng: information.lon,
    });
    if (distance > input.radiusMeters) continue;

    stations.push({
      id: information.station_id,
      name: information.name,
      lat: information.lat,
      lng: information.lon,
      distanceMeters: distance,
      ...(information.address ? { address: information.address } : {}),
      capacity: toOptionalCount(information.capacity),
      vehiclesAvailable: toTotalAvailable(status),
      vehicles: toVehicleAvailability(status, vehicleTypes),
      docksAvailable: toOptionalCount(status.num_docks_available),
      // Un champ absent vaut « oui » : la spécification GBFS ne l'exige que
      // lorsque la station s'écarte de son fonctionnement normal.
      renting: status.is_renting !== false,
      returning: status.is_returning !== false,
      lastReportedAt: toIsoDate(status.last_reported),
    });
  }

  // Tri puis découpe : le classement porte sur toutes les stations du rayon, et
  // non sur les premières rencontrées dans un flux dont l'ordre n'est pas garanti.
  stations.sort((left, right) => left.distanceMeters - right.distanceMeters);
  return stations.slice(0, input.limit);
}
