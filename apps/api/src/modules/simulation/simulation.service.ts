import { BadRequestException, Injectable } from '@nestjs/common';
import {
  SIMULATION_STEP_INTERVAL_MS,
  SIMULATION_TICKS,
  type LineStringGeometry,
} from '@urbanflow/shared';

import { SimulateTripDto, SimulatedSegmentDto } from './dto/simulate-trip.dto';
import { SimulationTickDto, TripSimulationDto } from './dto/trip-simulation.dto';

/** Un segment ramené à ce que l'interpolation manipule : une fenêtre de temps et un chemin. */
interface TimedSegment {
  /** Index dans les segments soumis — c'est lui qui est publié, pas l'index filtré. */
  index: number;
  /** Début du segment dans le temps du trajet, en secondes. */
  startSeconds: number;
  /** Durée du segment, en secondes. */
  durationSeconds: number;
  /** Tracé du segment, `null` quand il n'en porte pas. */
  geometry: LineStringGeometry | null;
}

/**
 * Service de simulation de trajet (UF-701) — l'outillage interne qui rend le
 * produit démontrable sans se déplacer.
 *
 * ## Ce qu'il fait
 *
 * Il transforme un itinéraire (des durées, des tracés) en une **trace** : une
 * trentaine de positions fictives que le client rejoue toutes les deux
 * secondes, du point de départ à la destination. Le guidage d'UF-806 les
 * consomme exactement comme des mesures GPS — même réducteur, même calcul de
 * progression, même détection d'arrivée. C'est ce qui garantit que la
 * démonstration montre le vrai parcours et non une maquette animée : si
 * l'arrivée se déclenche en simulation, elle se déclenchera sur le terrain.
 *
 * ## Le temps, pas la distance
 *
 * Les pas découpent le **temps** du trajet, pas sa longueur. Un pas vaut donc
 * quelques mètres à pied et quelques centaines en métro — ce qui est
 * précisément ce qu'on veut voir : la part du trajet passée dans chaque mode,
 * et donc l'endroit où part le CO₂. Découper la distance aurait montré
 * l'inverse, un point qui ralentit dans le métro.
 *
 * Le nombre de pas est **fixe** (voir `SIMULATION_TICKS`) : la démonstration
 * dure une minute quel que soit le trajet. La vitesse à l'écran n'est donc pas
 * à l'échelle ; les proportions entre segments, elles, le sont.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il ne calcule **aucune empreinte**. Le compteur CO₂ du guidage se déduit de
 * la progression, côté client, à partir des grammes que le Service Carbone a
 * déjà publiés sur chaque segment (étape 6 du flux). Recalculer ici donnerait
 * deux autorités sur le même chiffre, et donc, tôt ou tard, deux chiffres.
 *
 * Il n'invente pas non plus de tracé : un segment sans géométrie est traversé
 * **sans bouger**, son temps s'écoule et la position reste au dernier point
 * connu. C'est ce que fait un usager qui attend son bus, et c'est préférable à
 * une ligne droite inventée entre deux arrêts.
 *
 * Couvre : C4 (endpoint réservé au rôle `admin`, entrées bornées), C5 (une
 * seule requête pour toute la démonstration — le client ne redemande rien),
 * C9 (géométries GeoJSON `[lng, lat]` lues telles que le contrat les publie).
 */
@Injectable()
export class SimulationService {
  /**
   * Construit la trace d'un itinéraire.
   *
   * @param dto Segments à rejouer, dans l'ordre du trajet
   * @returns La trace complète : cadence et positions successives
   * @throws BadRequestException si aucun segment ne porte de tracé exploitable
   */
  simulate(dto: SimulateTripDto): TripSimulationDto {
    const timed = this.toTimedSegments(dto.segments);
    const totalSeconds = timed.reduce((sum, segment) => sum + segment.durationSeconds, 0);

    if (!timed.some((segment) => segment.geometry)) {
      // Refus explicite plutôt qu'une trace immobile : un itinéraire sans
      // aucun tracé ne peut pas être montré sur une carte, et une simulation
      // qui ne bouge pas ressemblerait à une panne (C7 — dire ce qui se passe).
      throw new BadRequestException('No segment carries a usable geometry to simulate');
    }

    const ticks: SimulationTickDto[] = [];
    for (let index = 0; index < SIMULATION_TICKS; index += 1) {
      /*
        `index / (SIMULATION_TICKS - 1)` et non `/ SIMULATION_TICKS` : la
        fraction doit atteindre 1 au dernier pas, sinon la trace s'arrête
        « presque » à destination et le rayon d'arrivée n'est jamais franchi.
        Le premier pas vaut 0, donc le point de départ exact.
      */
      const ratio = SIMULATION_TICKS > 1 ? index / (SIMULATION_TICKS - 1) : 1;
      const elapsedSeconds = totalSeconds * ratio;
      const { segment, point } = this.locate(timed, elapsedSeconds);

      ticks.push({
        index,
        lat: point[1],
        lng: point[0],
        segmentIndex: segment.index,
        elapsedSeconds: Math.round(elapsedSeconds),
      });
    }

    return { stepIntervalMs: SIMULATION_STEP_INTERVAL_MS, ticks };
  }

  /**
   * Pose chaque segment sur l'axe du temps.
   *
   * Une durée nulle est acceptée telle quelle : c'est une correspondance sur
   * place, et la refuser interdirait de simuler les itinéraires multimodaux —
   * c'est-à-dire le cœur du produit.
   */
  private toTimedSegments(segments: SimulatedSegmentDto[]): TimedSegment[] {
    let cursor = 0;
    return segments.map((segment, index) => {
      const durationSeconds = segment.durationMinutes * 60;
      const timed: TimedSegment = {
        index,
        startSeconds: cursor,
        durationSeconds,
        geometry:
          segment.geometry && segment.geometry.coordinates.length >= 2 ? segment.geometry : null,
      };
      cursor += durationSeconds;
      return timed;
    });
  }

  /**
   * Où se trouve-t-on à cet instant du trajet ?
   *
   * Le segment retenu est le **dernier** dont la fenêtre a commencé : sur une
   * frontière exacte (`elapsed === startSeconds` du suivant), on est déjà sur
   * le suivant, et non encore sur le précédent. Sans cette règle, un trajet
   * dont un segment dure zéro minute — une correspondance sur place — ne
   * serait jamais quitté.
   *
   * Un segment sans tracé emprunte le dernier point connu : la position se
   * fige le temps qu'il dure. Si aucun segment antérieur n'en portait — le
   * trajet commence par une attente — on prend le premier point à venir,
   * plutôt que de rendre la trace inexploitable dès son premier pas.
   */
  private locate(
    segments: TimedSegment[],
    elapsedSeconds: number,
  ): { segment: TimedSegment; point: [number, number] } {
    let current = segments[0];
    for (const segment of segments) {
      if (elapsedSeconds >= segment.startSeconds) current = segment;
    }

    if (current.geometry) {
      const span = current.durationSeconds;
      const ratio =
        span > 0 ? Math.min(1, Math.max(0, (elapsedSeconds - current.startSeconds) / span)) : 1;
      return { segment: current, point: interpolateAlong(current.geometry.coordinates, ratio) };
    }

    const previous = segments
      .filter((segment) => segment.index < current.index && segment.geometry)
      .pop();
    if (previous?.geometry) {
      const coordinates = previous.geometry.coordinates;
      return { segment: current, point: coordinates[coordinates.length - 1] };
    }

    const next = segments.find((segment) => segment.index > current.index && segment.geometry);
    // `simulate` a déjà vérifié qu'au moins un segment porte un tracé : quand
    // le segment courant n'en a pas, l'un des deux replis aboutit forcément.
    const fallback = next?.geometry?.coordinates[0] ?? [0, 0];
    return { segment: current, point: fallback };
  }
}

/**
 * Point situé à `ratio` de la longueur d'une polyligne (UF-701).
 *
 * Fonction pure, exportée pour être testée seule. L'interpolation se fait sur
 * la **longueur cumulée** et non sur l'index des sommets : un tracé OTP a des
 * sommets très inégalement espacés (dense dans les virages, épars en ligne
 * droite), et avancer d'un sommet par pas ferait bondir le point d'un côté à
 * l'autre du carrefour puis ramper sur la ligne droite.
 *
 * La longueur est mesurée en **degrés**, sans correction de latitude : à
 * l'échelle d'une métropole, le facteur `cos(lat)` est quasi constant d'un
 * tronçon à l'autre et se simplifie dans le rapport. On ne cherche pas ici une
 * distance, seulement une proportion — le calcul métrique exact vit côté
 * client, dans `lib/route-progress.ts`, là où il sert à afficher des mètres.
 *
 * @param coordinates Sommets `[lng, lat]`, au moins deux
 * @param ratio Position voulue le long du tracé, entre 0 (début) et 1 (fin)
 * @returns Le point interpolé, en `[lng, lat]`
 */
export function interpolateAlong(
  coordinates: readonly [number, number][],
  ratio: number,
): [number, number] {
  const clamped = Math.min(1, Math.max(0, ratio));
  if (clamped >= 1) return coordinates[coordinates.length - 1];
  if (clamped <= 0) return coordinates[0];

  const legs: number[] = [];
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const [aLng, aLat] = coordinates[index];
    const [bLng, bLat] = coordinates[index + 1];
    const length = Math.hypot(bLng - aLng, bLat - aLat);
    legs.push(length);
    total += length;
  }

  // Tracé de longueur nulle (tous les sommets confondus) : aucune proportion à
  // établir, le premier point vaut tous les autres.
  if (total === 0) return coordinates[0];

  let remaining = total * clamped;
  for (let index = 0; index < legs.length; index += 1) {
    if (remaining <= legs[index] || index === legs.length - 1) {
      const t = legs[index] > 0 ? remaining / legs[index] : 0;
      const [aLng, aLat] = coordinates[index];
      const [bLng, bLat] = coordinates[index + 1];
      return [aLng + (bLng - aLng) * t, aLat + (bLat - aLat) * t];
    }
    remaining -= legs[index];
  }

  return coordinates[coordinates.length - 1];
}
