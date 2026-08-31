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
  /**
   * Instant de départ souhaité (ISO 8601 avec fuseau) — UF-804.
   *
   * Absent = « maintenant », ce qui reste le cas de très loin le plus fréquent :
   * la chip du planificateur s'ouvre dessus. Le champ ne descend que jusqu'au
   * moteur GTFS, seule source dont le résultat dépende de l'heure — un vélo en
   * libre-service et un tronçon cyclable sont les mêmes à 8 h et à 22 h.
   */
  departAt?: string;
  /**
   * Nombre de voyageurs du groupe — UF-804, entre {@link MIN_TRAVELLERS} et
   * {@link MAX_TRAVELLERS}, `1` par défaut.
   *
   * Ce n'est **pas** un champ décoratif : il devient une exigence de
   * disponibilité sur les mobilités partagées. Proposer un Vélo'v à quatre
   * personnes depuis une borne qui n'en a qu'un est une réponse fausse, et
   * elle ne se découvre qu'une fois sur place — là où l'usager ne peut plus
   * rien en faire (C10).
   *
   * Il ne touche ni aux transports en commun (la capacité d'un métro ne se
   * modélise pas depuis un GTFS) ni à l'empreinte publiée, qui reste celle
   * d'**un** voyageur : multiplier les grammes par la taille du groupe
   * changerait la signification du chiffre d'une recherche à l'autre.
   */
  travellers?: number;
  /**
   * Modes retenus par l'usager pour **cette** recherche — UF-804.
   *
   * Absent = aucune restriction : les préférences du profil (F1) s'appliquent
   * alors seules, telles qu'elles l'ont toujours fait. Présent, c'est un
   * **filtre dur** : un itinéraire qui emprunte un mode décoché n'est pas
   * proposé.
   *
   * La différence avec `preferredModes` du profil est délibérée. Le profil dit
   * un goût durable, qui départage à qualité égale ; le sélecteur de l'écran
   * dit une contrainte du moment (« pas de métro aujourd'hui »), et une
   * contrainte qui n'exclut rien n'est pas une contrainte.
   *
   * {@link TransportMode.WALK} est toujours accepté, qu'il figure ou non dans
   * la liste : tout itinéraire commence et finit à pied, et l'exclure ne
   * laisserait aucune proposition constructible.
   */
  modes?: TransportMode[];
}

/** Plus petit groupe possible : le voyageur seul, et le défaut du planificateur. */
export const MIN_TRAVELLERS = 1;

/**
 * Plus grand groupe accepté par le planificateur.
 *
 * Huit, parce que c'est l'ordre de grandeur au-delà duquel une borne Vélo'v ne
 * répond plus jamais à la demande (la plus grande station du réseau en compte
 * une trentaine, rarement toutes louables) : accepter des valeurs plus hautes
 * offrirait surtout un moyen de vider systématiquement les résultats. Borner
 * ferme aussi la porte à un entier géant envoyé pour voir (C4).
 */
export const MAX_TRAVELLERS = 8;

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
 *
 * ## Ce que le client a le droit d'en faire (UF-503)
 *
 * C'est **l'ordre par défaut**, pas un ordre imposé. Le panneau de résultats
 * s'ouvre dessus, puis laisse l'usager relire la même liste par durée sans
 * repasser par l'API : réordonner cinq itinéraires déjà reçus ne justifie pas
 * de relancer la collecte des trois sources, qui pourrait d'ailleurs rendre des
 * itinéraires *différents* (C5/C10).
 *
 * La frontière est donc : le serveur décide de l'ordre **publié**, le client
 * peut changer l'ordre **affiché** — et jamais les valeurs, ni le contenu de la
 * liste. C'est ce qui garde `sortedBy` honnête tout en rendant le tri
 * secondaire gratuit.
 */
export type ItinerarySortKey =
  /** Empreinte carbone croissante — priorité « écolo », choix par défaut du produit. */
  | 'carbonAsc'
  /** Durée totale croissante — priorité « rapide ». */
  | 'durationAsc';

/**
 * Contraintes du profil qui ont **réduit** la liste rendue (UF-602, C7/C12).
 *
 * Publiées parce que le client ne peut pas les déduire : une liste courte, ou
 * vide, ne dit pas d'elle-même si le réseau ne propose rien ou si un filtre a
 * écarté ce qu'il proposait. Sans cette information, l'usager en fauteuil qui
 * ne voit plus qu'une option ignore qu'il en existait quatre — et l'application
 * lui cache la raison de son propre résultat (WCAG 3.3.1 : une contrainte qui
 * agit doit être identifiable).
 *
 * Ne portent que les contraintes **dures**, celles qui retirent des options.
 * La priorité de tri n'en est pas une : elle réordonne sans rien enlever, et
 * `sortedBy` la dit déjà.
 */
export interface AppliedRouteConstraints {
  /**
   * Le profil demande des itinéraires praticables en fauteuil roulant (C12).
   *
   * Effet réel, en deux temps : la requête envoyée à OpenTripPlanner porte
   * `wheelchair: true`, puis la fusion écarte tout candidat non accessible
   * (`itinerary-merger.ts`). Ce n'est donc pas une préférence de classement.
   */
  reducedMobility: boolean;
  /**
   * Modes que le **sélecteur de l'écran** a écartés de cette recherche (UF-804).
   *
   * Absent quand l'usager n'a rien décoché — et non « tableau vide » : le
   * client doit pouvoir distinguer « aucune exclusion » d'« une réponse d'un
   * cache antérieur au ticket », exactement comme pour `appliedConstraints`
   * lui-même.
   *
   * Publié parce qu'une liste courte, ou vide, ne dit pas d'elle-même si le
   * réseau ne propose rien ou si un mode décoché a écarté ce qu'il proposait.
   * C'est le même raisonnement que `reducedMobility`, appliqué à une contrainte
   * que l'usager vient de poser lui-même — et qu'il peut donc défaire.
   */
  excludedModes?: TransportMode[];
  /**
   * Taille du groupe exigée des bornes en libre-service (UF-804).
   *
   * Absent quand la recherche portait sur un seul voyageur, c'est-à-dire quand
   * la contrainte n'a rien retiré. Au-delà, elle en retire beaucoup : c'est ce
   * qui explique une liste sans option vélo dans un quartier pourtant bien
   * équipé.
   */
  travellers?: number;
}

/** Réponse de POST /api/routes/plan, triée selon la priorité du profil. */
export interface PlanRoutesResponse {
  itineraries: Itinerary[];
  sortedBy: ItinerarySortKey;
  /**
   * Contraintes du profil appliquées à **cette** recherche (UF-602).
   *
   * Toujours présent, y compris quand aucune contrainte n'est active : le
   * client doit pouvoir distinguer « aucun filtre » d'« une réponse d'un cache
   * antérieur au ticket », et le second cas se lit à l'absence du champ.
   */
  appliedConstraints: AppliedRouteConstraints;
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
