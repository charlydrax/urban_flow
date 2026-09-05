import type { LineStringGeometry } from './route';

/**
 * Contrats du mode simulation de trajet (UF-701) — `POST /api/simulation/trip`.
 *
 * ## À quoi sert ce mode, et pourquoi il est protégé
 *
 * Le guidage d'UF-806 suit la position réelle du téléphone. Démontrer le
 * produit — en soutenance, en recette, sur un poste fixe — supposait donc de
 * marcher réellement de la Part-Dieu à Bellecour : le trajet ne démarrait
 * jamais, et rien de ce qui dépend de l'arrivée (le suivi carbone d'UF-807)
 * n'était observable.
 *
 * La simulation rejoue le trajet sur une position fictive. C'est un **outil
 * interne**, pas une fonctionnalité citoyenne : un usager n'a aucune raison
 * de se fabriquer un déplacement, et lui en donner le moyen reviendrait à
 * ouvrir une porte sur le suivi carbone personnel — un bilan qu'on peut se
 * fabriquer ne vaut plus rien (même argument qu'UF-505 sur les grammes envoyés
 * par le client). D'où le rôle `admin` exigé sur cet endpoint (C4 / OWASP A01).
 *
 * ## Pourquoi la trace vient du serveur
 *
 * Le client possède déjà les géométries : il *pourrait* interpoler lui-même.
 * Faire produire la trace par l'API donne à l'autorisation un objet à
 * protéger — sans `admin`, la réponse est un `403`, et le bouton n'a rien à
 * animer. C'est aussi ce qui rend la recette du ticket vérifiable au niveau
 * du réseau, avec deux comptes et sans lire le code du navigateur.
 */

/**
 * Un segment tel que le client le soumet à la simulation.
 *
 * Réduit à ce que l'interpolation consomme — durée et tracé — sur le même
 * principe que `SelectedSegmentPayload` (UF-505) : on n'envoie au serveur que
 * ce dont il a besoin pour répondre. Ni mode, ni empreinte : la simulation ne
 * valorise rien, elle déplace un point.
 */
export interface SimulatedSegmentPayload {
  /** Durée annoncée du segment, en minutes — c'est elle qui donne son rythme. */
  durationMinutes: number;
  /**
   * Tracé du segment, en `[lng, lat]` (RFC 7946 — C9).
   *
   * Facultatif au même titre que `RouteSegment.geometry` : un pas qui n'a pas
   * produit deux points distincts n'en porte pas. Un segment sans tracé est
   * **traversé sans bouger** — son temps s'écoule, la position reste au
   * dernier point connu. C'est ce que fait un usager qui attend son bus.
   */
  geometry?: LineStringGeometry;
}

/** Corps de `POST /api/simulation/trip`. */
export interface SimulateTripRequest {
  /** Segments de l'itinéraire à rejouer, dans l'ordre du trajet. */
  segments: SimulatedSegmentPayload[];
}

/**
 * Une position fictive de la trace, à rejouer telle quelle.
 *
 * Aucun horodatage absolu : la trace est rejouée « maintenant », quel que soit
 * le moment où elle a été demandée. `elapsedSeconds` dit où l'on en est du
 * **temps du trajet simulé**, pas du temps réel de la démonstration — les deux
 * ne sont pas à la même échelle, un trajet de 22 minutes se rejoue en une.
 */
export interface SimulationTick {
  /** Rang du pas dans la trace, à partir de 0. */
  index: number;
  /** Latitude WGS84 de la position fictive. */
  lat: number;
  /** Longitude WGS84. */
  lng: number;
  /** Index, dans `segments`, du segment en cours à ce pas. */
  segmentIndex: number;
  /** Temps écoulé **dans le trajet simulé** à ce pas, en secondes. */
  elapsedSeconds: number;
}

/** Réponse de `POST /api/simulation/trip` — la trace complète, prête à rejouer. */
export interface TripSimulation {
  /** Intervalle réel entre deux pas, en millisecondes. */
  stepIntervalMs: number;
  /**
   * Positions successives, du départ à la destination.
   *
   * Le **dernier pas tombe exactement sur le dernier point du tracé** : c'est
   * ce qui fait franchir au guidage son rayon d'arrivée et déclencher tout ce
   * qui en dépend (UF-807). Une trace qui s'arrêterait « presque » à
   * destination ne démontrerait pas le parcours complet.
   */
  ticks: SimulationTick[];
}

/**
 * Intervalle entre deux pas de simulation, en millisecondes — la cadence
 * demandée par UF-701.
 *
 * Deux secondes : assez lent pour qu'un spectateur suive le point sur la carte
 * et lise le compteur s'incrémenter, assez rapide pour qu'un trajet entier
 * tienne dans une minute de démonstration.
 */
export const SIMULATION_STEP_INTERVAL_MS = 2000;

/**
 * Nombre de pas d'une trace, quelle que soit la longueur du trajet.
 *
 * Un nombre **fixe** et non une cadence proportionnelle à la durée réelle :
 * sinon un trajet de 45 minutes durerait quinze fois plus longtemps à
 * démontrer qu'un trajet de 3 minutes, et la démonstration deviendrait
 * imprévisible. Trente pas à deux secondes font une minute — le temps qu'on
 * peut consacrer à regarder une carte pendant une soutenance de 40 minutes.
 *
 * La conséquence assumée : la vitesse à l'écran n'est pas à l'échelle. Les
 * **proportions**, elles, le sont — un segment de bus de 8 minutes occupe
 * bien quatre fois plus de pas qu'une marche de 2 minutes, et c'est ce que la
 * démonstration doit montrer.
 */
export const SIMULATION_TICKS = 30;

/**
 * Nombre maximal de segments acceptés dans une demande de simulation.
 * Même borne que les écritures de trajet (UF-505/UF-807) : un itinéraire
 * urbain multimodal en compte une poignée, et la borne empêche de faire
 * boucler le serveur sur une liste fabriquée (C4/C5).
 */
export const SIMULATION_MAX_SEGMENTS = 50;

/**
 * Nombre maximal de points acceptés par tracé de segment.
 *
 * Un tracé OTP de segment urbain en compte quelques centaines. Le plafond
 * n'existe pas pour eux mais pour la requête fabriquée : sans lui, un seul
 * appel autorisé pourrait faire projeter des millions de points (C4/C5).
 */
export const SIMULATION_MAX_POINTS_PER_SEGMENT = 2000;
