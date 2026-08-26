import type { Place } from './route';
import { TransportMode } from './transport-mode';

/**
 * Contrats du connecteur mobilités douces (F3 — UF-303).
 *
 * Ces types décrivent une station de véhicules en libre-service
 * **indépendamment de GBFS** : le Service Itinéraire (F2) et le client ne
 * connaissent que ce vocabulaire. Si l'opérateur change de format ou si une
 * seconde flotte s'ajoute (trottinettes), seul le mapper de
 * `apps/api/src/modules/transport/gbfs` est à réécrire.
 *
 * Les distances sont en mètres — même unité que `RouteSegment` (`route.ts`) et
 * que `TransitLeg` (`transit.ts`). Les horodatages sont des chaînes ISO 8601
 * avec fuseau : GBFS publie des secondes epoch, sérialiser en ISO évite toute
 * ambiguïté lors du passage par JSON.
 */

/** Disponibilité d'une catégorie de véhicules à une station. */
export interface SharedVehicleAvailability {
  /** Mode normalisé, vocabulaire commun front/back (C9) : `BIKE` ou `SCOOTER`. */
  mode: TransportMode;
  /**
   * Véhicule à assistance électrique.
   *
   * Distingué du mode plutôt que fondu dedans : un vélo à assistance et un vélo
   * musculaire n'ont ni la même portée ni le même facteur d'émission (le
   * Service Carbone en aura besoin), mais restent le même mode de transport.
   */
  electric: boolean;
  /** Nombre de véhicules de cette catégorie effectivement louables. */
  count: number;
}

/** Station de véhicules en libre-service, à proximité d'un point demandé. */
export interface SharedMobilityStation {
  /** Identifiant de la station chez l'opérateur (`station_id` GBFS). */
  id: string;
  /** Libellé lisible (« PART-DIEU / VILLETTE »). */
  name: string;
  lat: number;
  lng: number;
  /** Distance à vol d'oiseau depuis le point demandé, arrondie au mètre. */
  distanceMeters: number;
  /** Adresse postale telle que publiée, absente si l'opérateur ne la donne pas. */
  address?: string;
  /** Nombre total d'emplacements, `null` si l'opérateur ne le publie pas. */
  capacity: number | null;
  /** Total des véhicules louables, toutes catégories confondues. */
  vehiclesAvailable: number;
  /** Détail par catégorie — vide si l'opérateur ne ventile pas sa flotte. */
  vehicles: SharedVehicleAvailability[];
  /** Emplacements libres pour rendre un véhicule, `null` si non publié. */
  docksAvailable: number | null;
  /** La station loue effectivement (une station pleine mais en panne ne loue pas). */
  renting: boolean;
  /** La station accepte les retours — utile pour un trajet qui *finit* en vélo. */
  returning: boolean;
  /**
   * Dernier instant où la station elle-même a rapporté son état (ISO 8601).
   *
   * Exposé parce que « le flux est frais » et « cette station est fraîche » sont
   * deux choses différentes : une borne hors réseau depuis des heures reste
   * publiée dans un flux mis à jour à la minute. Le client peut ainsi nuancer
   * un affichage plutôt que d'annoncer une disponibilité périmée.
   */
  lastReportedAt: string | null;
}

/** Raison pour laquelle le flux de mobilité partagée n'a pas pu être exploité (C10). */
export type SharedMobilityUnavailableReason =
  /** L'opérateur n'a pas répondu dans le délai imparti. */
  | 'timeout'
  /** Injoignable : DNS, connexion refusée, coupure réseau. */
  | 'network'
  /** Réponse reçue mais inexploitable : HTTP 4xx/5xx, corps illisible, flux absent. */
  | 'upstream-error';

/**
 * Résultat d'une recherche de stations proches.
 *
 * Une panne de l'opérateur n'est **jamais** une exception : elle est décrite ici
 * pour que le Service Itinéraire ignore les mobilités douces et retourne quand
 * même les autres options (dégradation gracieuse — C10). Un `status: 'ok'` avec
 * `stations` vide signifie « le flux a répondu, mais aucune station dans le
 * rayon » — ce n'est pas une panne.
 */
export interface NearbyStationsResult {
  status: 'ok' | 'unavailable';
  /** Stations du rayon, triées par distance croissante. */
  stations: SharedMobilityStation[];
  /** Renseigné uniquement quand `status` vaut `'unavailable'`. */
  unavailableReason?: SharedMobilityUnavailableReason;
  /** Rayon réellement appliqué en mètres, après bornage côté serveur. */
  radiusMeters: number;
  /**
   * Instant de publication du statut par l'opérateur (ISO 8601), `null` si
   * indisponible. C'est la preuve de fraîcheur de la réponse — pas l'heure à
   * laquelle notre API a répondu, qui ne dirait rien de la donnée elle-même.
   */
  publishedAt: string | null;
}

/** Point autour duquel chercher des stations. Les coordonnées sont obligatoires. */
export interface GeoPoint extends Place {
  lat: number;
  lng: number;
}

/** Paramètres d'une recherche de stations proches. */
export interface NearbyStationsQuery {
  lat: number;
  lng: number;
  /** Rayon de recherche en mètres (défaut : 500 — la distance qu'on fait à pied). */
  radius?: number;
  /** Nombre maximal de stations retournées (défaut : 10 — C5). */
  limit?: number;
}

/** Rayon appliqué par défaut : environ six minutes de marche. */
export const DEFAULT_STATION_RADIUS_METERS = 500;

/**
 * Rayon maximal accepté.
 *
 * Au-delà de deux kilomètres, une station n'est plus une option de rabattement :
 * la marche pour l'atteindre coûterait davantage que le trajet à vélo. Borner
 * évite aussi qu'une requête unique ne balaie et ne renvoie tout le réseau (C5).
 */
export const MAX_STATION_RADIUS_METERS = 2000;

/** Nombre de stations retournées par défaut. */
export const DEFAULT_STATION_LIMIT = 10;

/** Plafond du nombre de stations : au-delà, on transporte des octets pour rien (C5). */
export const MAX_STATION_LIMIT = 50;
