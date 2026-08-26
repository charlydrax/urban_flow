/**
 * Forme **brute** des flux GBFS, telle que publiée par l'opérateur.
 *
 * Ces types ne franchissent pas le dossier `gbfs/` : le reste de l'application
 * ne connaît que les contrats de `@urbanflow/shared`. Ils décrivent GBFS 2.x
 * (version publiée par Vélo'v) tout en restant compatibles GBFS 3.x, dont la
 * seule différence structurante ici est la disparition du niveau « langue »
 * dans le document d'auto-découverte.
 *
 * Spécification : https://github.com/MobilityData/gbfs/blob/master/gbfs.md
 *
 * Tous les champs optionnels le sont *dans la spécification* : un flux conforme
 * peut légitimement ne pas publier la capacité d'une station. Les marquer
 * facultatifs ici force le mapper à traiter le cas, plutôt que de découvrir
 * l'absence à l'exécution.
 */

/** Enveloppe commune à tous les flux GBFS. */
export interface GbfsFeed<T> {
  /** Dernière publication du flux, en secondes epoch. */
  last_updated: number;
  /** Durée de validité annoncée par l'opérateur, en secondes. */
  ttl?: number;
  version?: string;
  data: T;
}

/** Une entrée du document d'auto-découverte : un nom de flux et son URL. */
export interface GbfsFeedDescriptor {
  name: string;
  url: string;
}

/**
 * Contenu de `gbfs.json`.
 *
 * En GBFS 2.x, `data` est indexé par code langue (`{ "fr": { feeds: [...] } }`) ;
 * en GBFS 3.x, `feeds` est directement sous `data`. Les deux formes sont
 * décrites pour que le client accepte l'une comme l'autre.
 */
export type GbfsDiscoveryData =
  | { feeds: GbfsFeedDescriptor[] }
  | Record<string, { feeds: GbfsFeedDescriptor[] }>;

/** Une station telle que décrite dans `station_information.json` (données quasi statiques). */
export interface GbfsStationInformation {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  address?: string;
  capacity?: number;
}

/** Décompte de véhicules d'un type donné à une station. */
export interface GbfsVehicleTypeCount {
  vehicle_type_id: string;
  count: number;
}

/** L'état temps réel d'une station, tel que publié dans `station_status.json`. */
export interface GbfsStationStatus {
  station_id: string;
  num_bikes_available?: number;
  num_docks_available?: number;
  /** Ventilation par type de véhicule — absente des flux à flotte homogène. */
  vehicle_types_available?: GbfsVehicleTypeCount[];
  /** La station existe physiquement et est déployée. */
  is_installed?: boolean;
  /** La station loue effectivement des véhicules. */
  is_renting?: boolean;
  /** La station accepte les retours. */
  is_returning?: boolean;
  /** Dernier rapport de la station elle-même, en secondes epoch. */
  last_reported?: number;
}

/**
 * Un type de véhicule de la flotte (`vehicle_types.json`).
 * `form_factor` est ce qui permet de distinguer un vélo d'une trottinette sans
 * rien deviner à partir des identifiants propriétaires de l'opérateur.
 */
export interface GbfsVehicleType {
  vehicle_type_id: string;
  /** `bicycle`, `scooter`, `moped`, `car`, `other`… (vocabulaire GBFS). */
  form_factor: string;
  /** `human`, `electric_assist`, `electric`, `combustion`… */
  propulsion_type: string;
  name?: string;
}

/** Charge utile de `station_information.json`. */
export interface GbfsStationInformationData {
  stations: GbfsStationInformation[];
}

/** Charge utile de `station_status.json`. */
export interface GbfsStationStatusData {
  stations: GbfsStationStatus[];
}

/** Charge utile de `vehicle_types.json`. */
export interface GbfsVehicleTypesData {
  vehicle_types: GbfsVehicleType[];
}
