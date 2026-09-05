'use client';

import type { Itinerary, TripSimulation } from '@urbanflow/shared';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { ApiError, apiClient } from '../../lib/api-client';
import { watchUserPosition } from '../../lib/geolocation';
import {
  INITIAL_NAVIGATION_STATE,
  navigationReducer,
  needsPositionWatch,
  type NavigationState,
} from '../../lib/navigation-machine';
import type { UserLocationState } from '../planner/use-user-location';

/**
 * Branche une source de positions sur la machine à états du guidage (UF-806,
 * UF-701).
 *
 * ## Partage des rôles
 *
 * | Qui                       | Ce qu'il fait                                        |
 * | ------------------------- | ---------------------------------------------------- |
 * | `lib/navigation-machine`  | décide de la phase et des libellés — pur, testé      |
 * | `lib/route-progress`      | projette la position sur le tracé — pur, testé       |
 * | `lib/travelled-carbon`    | déduit les grammes déjà émis — pur, testé            |
 * | **ce hook**               | ouvre et ferme la source de positions, et rien d'autre |
 *
 * Tout ce qui se calcule sans navigateur est calculé sans navigateur : il ne
 * reste ici que ce qu'on ne peut pas tester en `node`, c'est-à-dire le cycle de
 * vie de l'abonnement. C'est la même frontière que `use-route-overlay.ts` face
 * à `route-map-layers.ts`.
 *
 * ## Deux sources, une seule machine
 *
 * Depuis UF-701, les positions peuvent venir de deux endroits :
 *
 * | Source        | Ouverte par | D'où viennent les positions                    |
 * | ------------- | ----------- | ---------------------------------------------- |
 * | `gps`         | `start`     | `watchUserPosition` — le capteur de l'appareil |
 * | `simulation`  | `simulate`  | une trace servie par `POST /simulation/trip`   |
 *
 * Le réducteur ne fait **aucune différence** entre les deux : mêmes
 * transitions, même calcul de progression, même détection d'arrivée, même
 * remontée `onArrival`. C'est délibéré — une démonstration qui emprunterait un
 * chemin de code à part ne prouverait rien du parcours réel.
 *
 * ## Le consentement n'est pas redemandé, il est réutilisé
 *
 * Le guidage réel ne recueille **aucun accord de son côté** : il s'appuie sur
 * le portail déjà livré par UF-202/UF-802 (`useUserLocation`), avec ses deux
 * parcours — accord horodaté en base pour un compte, mémorisé sur l'appareil
 * pour un invité. En pratique :
 *
 * - une position est déjà connue → le guidage démarre immédiatement ;
 * - aucune position n'est connue → `requestLocation()` ouvre le portail
 *   existant, et le guidage démarre **tout seul** dès qu'une position arrive.
 *
 * Ajouter un second point de collecte aurait donné deux endroits où l'accord se
 * demande, deux endroits où il se révoque, et un seul des deux tracé côté
 * serveur (C8). Le refus, lui, ne demande rien de particulier : sans position,
 * le guidage ne démarre pas, et le portail a déjà dit pourquoi.
 *
 * **La simulation, elle, ne demande rien du tout** (UF-701) : elle n'ouvre pas
 * le portail, ne lit pas le capteur et ne touche pas au consentement. C'est ce
 * qui rend la géolocalisation réelle facultative pour démontrer le produit —
 * elle reste l'option terrain, elle n'est plus le péage d'entrée.
 *
 * ## L'arrivée est le seul moment où le guidage parle au serveur (UF-807)
 *
 * Jusqu'à UF-806, ce hook n'écrivait rien : il lisait un itinéraire déjà reçu
 * et une position déjà consentie. Il publie désormais **un** événement, et un
 * seul — « arrivé » — parce que c'est lui qui distingue un trajet parcouru
 * d'une option cliquée, et donc ce que le suivi carbone a le droit de compter.
 * Il ne l'émet pas lui-même : il appelle `onArrival`, et c'est le planificateur
 * qui sait sur quelle ligne d'historique l'inscrire.
 *
 * La simulation ajoute **une** requête, et une seule, au tout début : la
 * demande de trace. Rien ensuite jusqu'à l'arrivée (C5).
 *
 * Couvre : C6 (suivi continu et échecs capteur), C8 (aucun consentement en
 * double, et aucun consentement du tout en simulation), C5 (la source de
 * positions ne vit que dans les phases qui en ont besoin), C4 (le refus `403`
 * d'un compte non autorisé est affiché, jamais contourné).
 *
 * @param location État du parcours « Me localiser », tel que le planificateur le tient déjà
 * @param onArrival Appelé **une fois par session**, quand la destination est atteinte
 */
export interface NavigationController {
  state: NavigationState;
  /** `true` entre le clic sur « Démarrer » et l'arrivée de la première position. */
  awaitingConsent: boolean;
  /** `true` entre le clic sur « Simuler » et l'arrivée de la trace (UF-701). */
  preparingSimulation: boolean;
  /**
   * Message d'échec de la dernière demande de simulation, `null` sinon (UF-701).
   *
   * Distinct des échecs du capteur (`state.failure`) : ceux-là décrivent un
   * GPS, celui-ci un refus ou une panne côté serveur. Les confondre ferait
   * afficher « activez la localisation » à un exploitant à qui il manque un
   * droit.
   */
  simulationError: string | null;
  /** Ouvre une session de guidage réel sur cet itinéraire (passe par le portail si besoin). */
  start: (itinerary: Itinerary) => void;
  /** Ouvre une session **simulée** sur cet itinéraire — réservée aux exploitants (UF-701). */
  simulate: (itinerary: Itinerary) => void;
  /** Suspend le guidage — le GPS est relâché, le trajet est gardé. */
  pause: () => void;
  /** Reprend un guidage suspendu. */
  resume: () => void;
  /** Ferme la session et efface la progression. */
  stop: () => void;
}

/**
 * Incertitude annoncée pour une position simulée, en mètres (UF-701).
 *
 * **Zéro, et pas une valeur « réaliste ».** Une position simulée est exacte :
 * elle n'a pas été mesurée, elle a été calculée. Lui attribuer un rayon
 * plausible — dix, trente mètres — ferait passer une fabrication pour une
 * mesure, jusque dans le libellé que la carte annonce sous le marqueur (C6/C9).
 * Ce que l'écran doit dire du mode simulation, il le dit en toutes lettres
 * dans son bandeau, pas en imitant le bruit d'un capteur.
 */
const SIMULATED_ACCURACY_METERS = 0;

/** Message affiché quand un compte sans le rôle `admin` demande une simulation. */
const SIMULATION_FORBIDDEN =
  'Le mode simulation est réservé aux comptes exploitants. Utilisez « Démarrer la navigation » pour un trajet réel.';

/** Message affiché quand la trace n'a pas pu être obtenue pour une autre raison. */
const SIMULATION_UNAVAILABLE =
  'La simulation n’a pas pu démarrer. Réessayez, ou lancez un trajet réel avec « Démarrer la navigation ».';

export function useNavigation(
  location: UserLocationState,
  onArrival?: (itinerary: Itinerary) => void,
): NavigationController {
  const [state, dispatch] = useReducer(navigationReducer, INITIAL_NAVIGATION_STATE);

  // Le rappel passe par une ref, comme `requestLocation` : l'appelant peut le
  // recréer à chaque rendu sans faire repartir l'effet d'arrivée, qui ne doit
  // dépendre que de la phase.
  const onArrivalRef = useRef(onArrival);
  onArrivalRef.current = onArrival;

  /**
   * Itinéraire retenu en attendant la position — le clic sur « Démarrer » a eu
   * lieu, le portail de consentement est ouvert, on ne peut pas encore guider.
   *
   * En état et non en ref : c'est lui qui met le bouton en « Localisation… »,
   * donc il doit provoquer un rendu.
   */
  const [pending, setPending] = useState<Itinerary | null>(null);

  /** `true` pendant l'aller-retour qui demande la trace de simulation (UF-701). */
  const [preparingSimulation, setPreparingSimulation] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  /**
   * Trace en cours de lecture, `null` hors simulation.
   *
   * En état parce que c'est elle qui arme l'effet de rejeu : le poser en ref
   * obligerait à déclencher l'effet par un autre moyen, et à tenir deux
   * sources de vérité sur « une simulation est-elle en cours ? ».
   */
  const [track, setTrack] = useState<TripSimulation | null>(null);

  const { position, requestLocation } = location;

  // `requestLocation` passe par une ref : son identité change avec la session
  // (`useCallback` dépend d'`isGuest`), et `start` ne doit pas être recréé pour
  // autant — c'est un rappel posé sur un bouton de la liste de résultats.
  const requestLocationRef = useRef(requestLocation);
  requestLocationRef.current = requestLocation;

  const start = useCallback(
    (itinerary: Itinerary) => {
      // Une session réelle chasse une simulation en cours : les deux sources
      // ne doivent jamais alimenter la même machine.
      setTrack(null);
      setSimulationError(null);
      // Position déjà consentie et connue : rien à demander, on guide.
      if (position) {
        dispatch({ type: 'start', itinerary, source: 'gps' });
        return;
      }
      setPending(itinerary);
      requestLocationRef.current();
    },
    [position],
  );

  /*
    Simulation (UF-701).

    Aucun portail de géolocalisation, aucun capteur : on demande la trace, et
    on la rejoue. C'est ce qui rend la géolocalisation réelle facultative pour
    démontrer le produit.

    Le refus `403` est **affiché**, pas contourné : le client n'a pas les
    moyens — ni le droit — de décider qu'un compte est exploitant, et la
    dissimulation du bouton côté interface n'est qu'un confort. La frontière
    est le guard serveur (C4).
  */
  const simulate = useCallback((itinerary: Itinerary) => {
    setPending(null);
    setSimulationError(null);
    setPreparingSimulation(true);

    apiClient
      .simulateTrip({
        segments: itinerary.segments.map((segment) => ({
          durationMinutes: segment.durationMinutes,
          geometry: segment.geometry,
        })),
      })
      .then((simulation) => {
        dispatch({ type: 'start', itinerary, source: 'simulation' });
        setTrack(simulation);
      })
      .catch((error: unknown) => {
        // `403` : compte authentifié, droit manquant. Le distinguer du reste
        // est ce qui permet de dire *pourquoi* plutôt que « réessayez ».
        const forbidden = error instanceof ApiError && error.status === 403;
        setSimulationError(forbidden ? SIMULATION_FORBIDDEN : SIMULATION_UNAVAILABLE);
      })
      .finally(() => setPreparingSimulation(false));
  }, []);

  // Le portail a abouti : la position promise est arrivée, le guidage démarre
  // sans que l'usager ait à recliquer sur « Démarrer ».
  useEffect(() => {
    if (!pending || !position) return;
    dispatch({ type: 'start', itinerary: pending, source: 'gps' });
    setPending(null);
  }, [pending, position]);

  // Refus, échec GPS ou abandon : le portail est retombé sur un état terminal
  // sans position. On relâche l'attente plutôt que de laisser le bouton tourner
  // indéfiniment — le message d'échec, lui, est déjà affiché par le portail.
  useEffect(() => {
    if (!pending) return;
    if (location.status === 'error' || location.status === 'idle') setPending(null);
  }, [pending, location.status]);

  const pause = useCallback(() => dispatch({ type: 'pause' }), []);
  const resume = useCallback(() => dispatch({ type: 'resume' }), []);
  const stop = useCallback(() => {
    setPending(null);
    setTrack(null);
    setSimulationError(null);
    dispatch({ type: 'stop' });
  }, []);

  /*
    Arrivée : l'événement qu'UF-807 attendait.

    Déclenché par la **phase**, pas par la position : `arrived` est un état
    terminal du réducteur (seul `stop` en sort), donc l'effet ne se rejoue pas
    aux mesures qui suivent — trois pas dans le hall n'ajoutent pas un second
    trajet au bilan. C'est aussi ce qui rend la règle testable sans GPS : la
    séquence d'événements qui mène à `arrived` est déjà rejouée par
    `navigation-machine.test.ts`.

    `state.itinerary` est celui sur lequel le guidage a démarré, et non l'option
    cochée dans la liste : on valorise ce qui a été parcouru.

    Une arrivée **simulée** remonte comme les autres, et c'est le point du
    ticket UF-701 : sans elle, l'empreinte d'un trajet ne serait jamais
    comptabilisée par qui ne se déplace pas, et la moitié du produit resterait
    invisible en démonstration.
  */
  useEffect(() => {
    if (state.phase !== 'arrived' || !state.itinerary) return;
    onArrivalRef.current?.(state.itinerary);
  }, [state.phase, state.itinerary]);

  /*
    Abonnement au capteur — ouvert et fermé par la seule phase.

    `needsPositionWatch` est la condition, et elle vit dans le module pur : le
    jour où une phase de plus s'ajoute, c'est un test `node` qui dit si le GPS
    doit tourner dedans, pas une relecture de cet effet. Depuis UF-701 elle lit
    aussi la source : en simulation, le capteur ne s'ouvre jamais.

    Le nettoyage est ce qui compte le plus ici (C5) : un abonnement haute
    précision oublié continue d'interroger le GPS après la fermeture de l'écran,
    et c'est exactement la fuite que `watchUserPosition` rend impossible à
    ignorer en renvoyant son propre arrêt.
  */
  const watching = needsPositionWatch(state.phase, state.source);
  useEffect(() => {
    if (!watching) return;

    return watchUserPosition({
      onPosition: (next) => dispatch({ type: 'position', position: next }),
      onFailure: (reason) => dispatch({ type: 'signal-lost', reason }),
    });
    // Le **booléen**, et non la phase : `guiding` et `signal-lost` demandent
    // tous deux le capteur, et l'aller-retour entre les deux — un tunnel — ne
    // doit pas fermer puis rouvrir l'abonnement à chaque passage. Encore moins
    // l'état entier, qui changerait à chaque mesure reçue.
  }, [watching]);

  /*
    Rejeu de la trace simulée (UF-701) — le pendant exact de l'effet ci-dessus.

    Un `setInterval` et non un `setTimeout` par pas : un seul minuteur à
    nettoyer, et une cadence qui ne dérive pas au fil de trente pas.

    Le compteur de pas vit dans une variable locale à l'effet, et non en état :
    le faire passer par React déclencherait un rendu de plus par pas, et
    surtout relancerait l'effet — donc le minuteur — à chaque fois. La position
    dispatchée provoque déjà le rendu qu'il faut.

    La trace s'arrête d'elle-même à son dernier point ; le minuteur est alors
    fermé, et il l'est aussi si l'écran est quitté en cours de route.
  */
  const guidingSimulation = state.source === 'simulation' && state.phase === 'guiding';
  useEffect(() => {
    if (!track || !guidingSimulation) return;

    let step = 0;
    const timer = setInterval(() => {
      const tick = track.ticks[step];
      if (!tick) {
        clearInterval(timer);
        return;
      }
      step += 1;
      dispatch({
        type: 'position',
        position: { lat: tick.lat, lng: tick.lng, accuracyMeters: SIMULATED_ACCURACY_METERS },
      });
    }, track.stepIntervalMs);

    return () => clearInterval(timer);
  }, [track, guidingSimulation]);

  return {
    state,
    awaitingConsent: pending !== null,
    preparingSimulation,
    simulationError,
    start,
    simulate,
    pause,
    resume,
    stop,
  };
}
