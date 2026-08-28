import { CarbonFootprint } from './carbon';
import { TransportMode } from './transport-mode';

/**
 * Contrats du planificateur d'itinéraires (F2) — `POST /api/routes/plan`.
 * Source de vérité unique du contrat front/back (C9) : les DTO NestJS
 * (`apps/api`) implémentent ces interfaces, le client (`apps/web`) les consomme.
 */

/** Lieu de départ/arrivée — coordonnées issues de la Geolocation API (C6). */
export interface Place {
  label: string;
  lat?: number;
  lng?: number;
}

/**
 * Corps de `POST /api/routes/plan`.
 *
 * ⚠️ **Aucun `userId`** (C4 / OWASP A01). Le diagramme de séquence du MVP en
 * portait un ; l'endpoint définitif (UF-402) ne l'accepte plus. L'auteur d'une
 * recherche est toujours le porteur du JWT vérifié — il n'y a donc aucun champ
 * à falsifier pour lire les préférences ou écrire dans l'historique d'un autre
 * compte. Le `ValidationPipe` global (`whitelist` + `forbidNonWhitelisted`) fait
 * d'ailleurs échouer en `400` toute requête qui en envoie un.
 */
export interface PlanRouteRequest {
  from: Place;
  to: Place;
}

/** Tracé GeoJSON LineString [lng, lat] pour l'affichage MapLibre (format standard — C9). */
export interface LineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

/** Segment d'itinéraire (une portion avec un seul mode) avec son empreinte CO₂. */
export interface RouteSegment {
  mode: TransportMode;
  from: string;
  to: string;
  durationMinutes: number;
  distanceMeters: number;
  carbonGrams: number;
  line?: string;
  /**
   * Départ effectif du segment (ISO 8601 avec fuseau) — UF-404.
   *
   * Renseigné uniquement quand la **source** le connaît, c'est-à-dire pour les
   * segments issus d'un trajet planifié par le moteur GTFS : un horaire de bus
   * est une donnée de la source, pas un calcul. Un tronçon vélo ou une marche
   * synthétisés à partir d'une distance et d'une vitesse n'ont, eux, aucun
   * horaire propre — leur en inventer un ferait passer une estimation pour une
   * information de réseau (C9).
   */
  departureAt?: string;
  /** Arrivée effective du segment (ISO 8601 avec fuseau) — mêmes règles que {@link departureAt}. */
  arrivalAt?: string;
  /**
   * Tracé du **segment seul**, en `[lng, lat]` (UF-403).
   *
   * Publié en plus de la géométrie d'ensemble de l'itinéraire parce que la
   * carte doit distinguer les modes : une couleur par mode et un style de trait
   * par famille (marche pointillée, vélo plein, TC tireté) ne se dessinent pas
   * depuis une `LineString` unique, où plus rien n'indique où la marche
   * s'arrête et où le métro commence. Le client aurait pu tenter de redécouper
   * la géométrie globale en s'appuyant sur les distances, mais ce serait
   * reconstruire par approximation une information que le serveur possède
   * exactement.
   *
   * Absent quand le pas n'a pas produit deux points distincts — la même règle
   * que {@link Itinerary.geometry} : pas de `LineString` invalide au sens de la
   * RFC 7946 (C9).
   */
  geometry?: LineStringGeometry;
}

/** Itinéraire multimodal complet (tracé GeoJSON pour MapLibre — C9, accessibilité PMR — C12). */
export interface Itinerary {
  id: string;
  summary: string;
  durationMinutes: number;
  distanceMeters: number;
  carbonGrams: number;
  /**
   * Détail du calcul carbone de cet itinéraire (UF-501) — total, ligne par
   * segment, et ce que le même trajet aurait coûté en voiture.
   *
   * Redondant avec {@link carbonGrams} ? Non : `carbonGrams` est la **clé de
   * tri**, que le client compare d'une carte à l'autre sans rien déplier ;
   * `carbon` est la **justification**, que l'usager ouvre quand il veut savoir
   * d'où sort le chiffre. Les deux valeurs sont produites par le même appel et
   * ne peuvent donc pas diverger : `carbonGrams === carbon.totalGrams`.
   *
   * Optionnel dans le contrat parce qu'un itinéraire venu d'un cache antérieur
   * à ce ticket n'en porte pas — l'affichage doit savoir s'en passer plutôt que
   * de planter sur un `undefined` (C10).
   */
  carbon?: CarbonFootprint;
  accessible: boolean;
  segments: RouteSegment[];
  /**
   * Heure de départ porte-à-porte (ISO 8601 avec fuseau) — UF-404.
   *
   * Publiée pour que le panneau de résultats affiche « Départ 09:47 · Arrivée
   * 10:03 » : sans horaires, deux options de même durée sont indiscernables
   * alors que l'une part dans deux minutes et l'autre dans un quart d'heure.
   *
   * **Absente dès qu'aucun segment n'est horodaté** (itinéraire tout-vélo, par
   * exemple) : il n'y a alors pas d'heure à annoncer, seulement une durée. La
   * fenêtre est **ancrée** sur les segments que la source horodate, et les
   * segments voisins sont décalés de leur propre durée — la même arithmétique
   * que {@link durationMinutes}, qui les additionne déjà.
   */
  departureAt?: string;
  /** Heure d'arrivée porte-à-porte (ISO 8601) — mêmes règles que {@link departureAt}. */
  arrivalAt?: string;
  geometry?: LineStringGeometry;
}

/**
 * Nom d'une des trois sources du planificateur (UF-305).
 *
 * Nommé plutôt que répété en union anonyme : la collecte (UF-305), l'état
 * publié au client et le diagnostic (UF-306) parlent des mêmes trois sources.
 * Un seul type garantit qu'ajouter une quatrième source casse à la compilation
 * partout où il faut la traiter, plutôt que silencieusement nulle part.
 */
export type RouteSourceName = 'transit' | 'sharedMobility' | 'cyclePaths';

/**
 * État d'une des trois sources interrogées par le planificateur (UF-305).
 *
 * Publié dans la réponse parce que le client ne peut pas le deviner : une liste
 * sans option vélo peut vouloir dire « aucun vélo praticable ici » ou «
 * l'opérateur n'a pas répondu », et ce n'est pas la même chose à annoncer à
 * l'usager. C'est ce qui alimente le bandeau « mode dégradé » (C10).
 */
export interface SourceAvailability {
  /** `transit` (GTFS), `sharedMobility` (GBFS) ou `cyclePaths` (PostGIS). */
  source: RouteSourceName;
  /** `false` quand la source n'a rien pu fournir pour cette recherche. */
  available: boolean;
  /**
   * Cause de l'indisponibilité, renseignée uniquement si `available` est `false`.
   *
   * Volontairement générique (`timeout`, `network`, `upstream-error`,
   * `internal-error`) : le détail technique reste dans les logs du serveur, il
   * n'apprendrait rien à l'usager et exposerait notre topologie (C11).
   */
  reason?: 'timeout' | 'network' | 'upstream-error' | 'internal-error';
}

/**
 * Clé de tri appliquée par le serveur à la liste d'itinéraires.
 *
 * Déduite de la priorité du profil de mobilité (F1) et **publiée** : le client
 * doit pouvoir annoncer « classés par empreinte » ou « classés par durée » sans
 * avoir à relire les préférences de l'usager, et sans déduire l'ordre en
 * comparant lui-même les valeurs.
 */
export type ItinerarySortKey =
  /** Empreinte carbone croissante — priorité « écolo », choix par défaut du produit. */
  | 'carbonAsc'
  /** Durée totale croissante — priorité « rapide ». */
  | 'durationAsc';

/** Réponse de POST /api/routes/plan, triée selon la priorité du profil. */
export interface PlanRoutesResponse {
  itineraries: Itinerary[];
  sortedBy: ItinerarySortKey;
  /**
   * État des trois sources pour **cette** recherche (UF-305).
   *
   * Toujours présent, même quand tout va bien : un tableau où les trois sources
   * sont `available` est une information, pas du remplissage — il dit que la
   * liste d'itinéraires est complète.
   */
  sources: SourceAvailability[];
  /**
   * Identifiant de la ligne écrite dans l'historique pour cette recherche
   * (UF-204, étape 18 du flux) — `null` si l'écriture a échoué.
   *
   * Publié pour que le client n'ait pas à enregistrer la recherche lui-même :
   * un second `POST /search-history` créerait un doublon de ce que le serveur
   * vient d'écrire. Il lui sert aussi de référence pour rattacher plus tard
   * l'option effectivement retenue.
   *
   * `null` n'est pas une erreur à afficher : ne pas mémoriser un trajet est un
   * désagrément, pas une panne de la recherche (C10).
   */
  searchHistoryId: string | null;
}
