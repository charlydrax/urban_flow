import type { LineStringGeometry, Place } from './route';
import { TransportMode } from './transport-mode';

/**
 * Contrats du connecteur transports en commun (F3 — UF-302).
 *
 * Ces types décrivent un trajet TC **indépendamment d'OpenTripPlanner** : le
 * Service Itinéraire (F2) et le client ne connaissent que ce vocabulaire. Si le
 * moteur de routage change un jour (OTP 3, Navitia, API opérateur), seul le
 * mapper de `apps/api/src/modules/transport/otp` est à réécrire.
 *
 * Les durées sont en minutes et les distances en mètres — mêmes unités que
 * `RouteSegment` (`route.ts`), pour que la conversion vers un itinéraire
 * multimodal reste une simple projection. Les horaires sont des chaînes ISO 8601
 * avec fuseau : le GTFS raisonne en heure locale, sérialiser en ISO évite toute
 * ambiguïté lors du passage par JSON.
 */

/** Point d'un trajet TC : une adresse, ou un arrêt identifié du réseau. */
export interface TransitPlace {
  /** Libellé lisible (« Gare Part-Dieu V.Merle », « Départ »). */
  name: string;
  lat: number;
  lng: number;
  /** Identifiant GTFS de l'arrêt (`agency:stop_id`), absent hors du réseau. */
  stopId?: string;
}

/** Portion d'un trajet effectuée d'une traite avec un seul mode. */
export interface TransitLeg {
  /** Mode normalisé, vocabulaire commun front/back (C9). */
  mode: TransportMode;
  /**
   * Mode brut renvoyé par le moteur de routage (`SUBWAY`, `FUNICULAR`, …).
   * Conservé pour la traçabilité : `mode` est une projection qui perd de
   * l'information (les funiculaires TCL deviennent `METRO`, par exemple).
   */
  sourceMode: string;
  /** `true` pour un trajet à bord d'un véhicule TC, `false` pour la marche. */
  transit: boolean;
  from: TransitPlace;
  to: TransitPlace;
  /** Départ effectif du segment (ISO 8601). */
  departureAt: string;
  /** Arrivée effective du segment (ISO 8601). */
  arrivalAt: string;
  durationMinutes: number;
  distanceMeters: number;
  /** Numéro de ligne commercial (« C9 », « B ») — donnée GTFS (C9). */
  line?: string;
  /** Libellé long de la ligne (« Hôpitaux Est --> Bellecour Le Viste »). */
  lineName?: string;
  /** Girouette du véhicule : la direction affichée à l'usager. */
  headsign?: string;
  /** Exploitant du service (« TCL SYTRAL »). */
  operator?: string;
  /** Segment praticable en fauteuil roulant d'après le GTFS (C12). */
  accessible: boolean;
  /** Tracé du segment pour MapLibre (C9). */
  geometry?: LineStringGeometry;
}

/** Trajet TC complet porte-à-porte, marche de rabattement comprise. */
export interface TransitJourney {
  /** Identifiant stable dans la réponse (`transit-1`, `transit-2`, …). */
  id: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  /** Distance totale parcourue à pied — critère de confort du profil (F1). */
  walkDistanceMeters: number;
  /** Nombre de correspondances (segments TC − 1, jamais négatif). */
  transfers: number;
  /** Tous les segments TC sont annoncés accessibles en fauteuil (C12). */
  accessible: boolean;
  legs: TransitLeg[];
  /** Tracé complet, concaténation des segments (C9). */
  geometry?: LineStringGeometry;
}

/** Raison pour laquelle le moteur de routage n'a pas pu être exploité (C10). */
export type TransitUnavailableReason =
  /** Le moteur n'a pas répondu dans le délai imparti. */
  | 'timeout'
  /** Injoignable : service arrêté, DNS, connexion refusée. */
  | 'network'
  /** Réponse reçue mais inexploitable : HTTP 5xx, erreurs GraphQL, corps illisible. */
  | 'upstream-error';

/**
 * Résultat du connecteur TC.
 *
 * Une panne du moteur n'est **jamais** une exception : elle est décrite ici pour
 * que le Service Itinéraire ignore le mode TC et retourne quand même les autres
 * options (dégradation gracieuse — C10). Un `status: 'ok'` avec `journeys` vide
 * signifie « le moteur a répondu, mais aucun trajet n'existe » — ce n'est pas
 * une panne.
 */
export interface TransitJourneysResult {
  status: 'ok' | 'unavailable';
  journeys: TransitJourney[];
  /** Renseigné uniquement quand `status` vaut `'unavailable'`. */
  unavailableReason?: TransitUnavailableReason;
  /** Date de départ demandée (AAAA-MM-JJ, heure locale du réseau). */
  requestedDate: string;
  /** Date réellement interrogée — diffère si le GTFS chargé est un instantané daté. */
  serviceDate: string;
  /** `true` quand `serviceDate` a dû être recalée dans la période couverte. */
  dateAdjusted: boolean;
}

/** Extrémité d'une recherche TC : les coordonnées sont obligatoires. */
export interface TransitEndpoint extends Place {
  lat: number;
  lng: number;
}

/** Paramètres d'une recherche de trajets TC. */
export interface TransitQuery {
  from: TransitEndpoint;
  to: TransitEndpoint;
  /** Instant de départ souhaité (ISO 8601). Par défaut : maintenant. */
  departureAt?: string;
  /** Ne retenir que les trajets praticables en fauteuil roulant (C12). */
  wheelchair?: boolean;
  /** Nombre maximal de trajets demandés au moteur (défaut : 3 — C5). */
  maxResults?: number;
}
