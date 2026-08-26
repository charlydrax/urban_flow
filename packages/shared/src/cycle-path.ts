import type { Place } from './route';

/**
 * Contrats des tronçons cyclables et piétons (F2 — UF-304).
 *
 * Ces types décrivent un aménagement cyclable **indépendamment de son
 * producteur** : le Service Itinéraire et le client ne connaissent que ce
 * vocabulaire. Le jeu de données du Grand Lyon publie vingt-trois attributs par
 * tronçon ; nous n'en retenons que ceux qui changent une décision d'itinéraire
 * ou un affichage — transporter le reste serait des octets pour rien (C5).
 *
 * Les distances sont en mètres, comme partout ailleurs (`RouteSegment`,
 * `TransitLeg`, `SharedMobilityStation`). Les tracés sont du **GeoJSON**
 * standard (C9), directement consommable par MapLibre côté front.
 */

/**
 * Type d'aménagement, normalisé depuis les libellés du producteur.
 *
 * Normalisé plutôt que recopié tel quel parce que la distinction porte une
 * décision : une piste séparée de la circulation, une bande peinte au sol et un
 * couloir partagé avec les bus n'offrent ni la même sécurité ni le même confort.
 * Le planificateur (F2) doit pouvoir les pondérer ; un libellé libre ne s'y
 * prête pas.
 */
export enum CycleFacilityType {
  /** Site propre séparé de la circulation générale (« Piste Cyclable »). */
  CYCLE_TRACK = 'CYCLE_TRACK',
  /** Bande cyclable marquée au sol, sur la chaussée. */
  CYCLE_LANE = 'CYCLE_LANE',
  /** Voie verte : site propre partagé avec les piétons — étape 12-13 du flux. */
  GREENWAY = 'GREENWAY',
  /** Double sens cyclable / vélorue : circulation apaisée partagée. */
  SHARED_STREET = 'SHARED_STREET',
  /** Couloir bus ouvert aux vélos. */
  BUS_LANE = 'BUS_LANE',
  /** Aménagement ponctuel de franchissement (goulotte, rampe d'escalier). */
  CROSSING = 'CROSSING',
  /** Libellé du producteur non reconnu — le tronçon existe, son type est incertain. */
  OTHER = 'OTHER',
}

/** Tracé d'un tronçon, au format GeoJSON (C9) — directement affichable par MapLibre. */
export interface CyclePathGeometry {
  type: 'MultiLineString';
  /** Un tableau de brins, chaque brin étant une suite de `[lng, lat]`. */
  coordinates: [number, number][][];
}

/** Un tronçon cyclable ou piéton proche du point demandé. */
export interface CycleSegment {
  /** Identifiant du tronçon chez le producteur — stable d'un import à l'autre. */
  id: string;
  /** Voie empruntée (« Rue Garibaldi »), `null` hors voirie nommée (parc, passerelle). */
  name: string | null;
  /** Type d'aménagement normalisé. */
  facilityType: CycleFacilityType;
  /** Libellé d'origine du producteur, conservé pour la traçabilité de la normalisation. */
  sourceFacilityType: string;
  /** Niveau de réseau (« Voies Lyonnaises »…), `null` si non renseigné. */
  network: string | null;
  /**
   * Revêtement tel que publié, `null` si non renseigné.
   *
   * Exposé pour C12 : un stabilisé sablé n'est praticable ni en fauteuil ni par
   * tous les vélos. C'est une information d'accessibilité, pas un détail de voirie.
   */
  surface: string | null;
  /**
   * Distance à vol d'oiseau entre le point demandé et le point **le plus proche**
   * du tronçon, arrondie au mètre.
   *
   * Distance au tronçon, pas à son milieu ni à son départ : un aménagement de
   * deux kilomètres qui passe devant chez soi est à quelques mètres, pas à mille.
   */
  distanceMeters: number;
  /**
   * Longueur totale du tronçon en mètres — pas la seule portion comprise dans le
   * rayon. Un tronçon peut donc être plus long que le rayon de recherche.
   */
  lengthMeters: number;
  /** Tracé complet du tronçon (GeoJSON). */
  geometry: CyclePathGeometry;
}

/**
 * Résultat d'une recherche de tronçons cyclables autour d'un point.
 *
 * Objet enveloppe plutôt que tableau nu (C9), pour la même raison que
 * `NearbyStationsResult` : il porte le rayon réellement appliqué après bornage
 * et la fraîcheur du jeu de données, que le client ne peut pas deviner.
 *
 * Il n'y a **pas** de `status: 'unavailable'` ici, à la différence des deux
 * connecteurs externes : cette source est notre propre base. Si elle tombe,
 * l'authentification et le profil sont tombés avec elle — ce n'est plus une
 * dégradation partielle mais une panne, et elle doit se voir comme telle.
 */
export interface CycleSegmentsResult {
  /** Tronçons du rayon, triés par distance croissante. */
  segments: CycleSegment[];
  /** Rayon réellement appliqué en mètres, après bornage côté serveur. */
  radiusMeters: number;
  /**
   * Date du dernier import du jeu de données (ISO 8601), `null` si la table est
   * vide — c'est-à-dire si l'import n'a jamais été lancé. Distinguer « aucun
   * aménagement à proximité » de « base non peuplée » évite de conclure à tort
   * qu'un quartier n'est pas équipé.
   */
  datasetImportedAt: string | null;
}

/** Point autour duquel chercher des tronçons. */
export interface CyclePathQueryPoint extends Place {
  lat: number;
  lng: number;
}

/** Paramètres d'une recherche de tronçons cyclables proches. */
export interface CycleSegmentsQuery {
  lat: number;
  lng: number;
  /** Rayon de recherche en mètres (défaut : 300). */
  radius?: number;
  /** Nombre maximal de tronçons retournés (défaut : 20 — C5). */
  limit?: number;
}

/**
 * Rayon appliqué par défaut.
 *
 * Plus court que celui des stations en libre-service (500 m) et ce n'est pas un
 * oubli : on marche jusqu'à une station, alors qu'un aménagement cyclable n'a
 * d'intérêt que s'il est sur le chemin. Au-delà de trois cents mètres, le détour
 * pour l'atteindre coûte plus qu'il ne rapporte.
 */
export const DEFAULT_CYCLE_RADIUS_METERS = 300;

/**
 * Rayon minimal accepté — aligné sur la précision réelle d'un GPS urbain
 * (20 à 60 m, C6). En dessous, le bruit de mesure ferait apparaître et
 * disparaître les tronçons au hasard.
 */
export const MIN_CYCLE_RADIUS_METERS = 50;

/**
 * Rayon maximal accepté.
 *
 * Deux kilomètres autour d'un point du centre de Lyon couvrent déjà plusieurs
 * centaines de tronçons : au-delà, la requête ne répond plus à « qu'y a-t-il
 * autour de moi » mais exporte le jeu de données (C5).
 */
export const MAX_CYCLE_RADIUS_METERS = 2000;

/** Nombre de tronçons retournés par défaut. */
export const DEFAULT_CYCLE_SEGMENTS_LIMIT = 20;

/** Plafond du nombre de tronçons : chaque tracé pèse, sur mobile plus qu'ailleurs (C5). */
export const MAX_CYCLE_SEGMENTS_LIMIT = 100;
