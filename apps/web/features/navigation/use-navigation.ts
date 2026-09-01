'use client';

import type { Itinerary } from '@urbanflow/shared';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { watchUserPosition } from '../../lib/geolocation';
import {
  INITIAL_NAVIGATION_STATE,
  navigationReducer,
  needsPositionWatch,
  type NavigationState,
} from '../../lib/navigation-machine';
import type { UserLocationState } from '../planner/use-user-location';

/**
 * Branche le capteur GPS sur la machine à états du guidage (UF-806).
 *
 * ## Partage des rôles
 *
 * | Qui                       | Ce qu'il fait                                        |
 * | ------------------------- | ---------------------------------------------------- |
 * | `lib/navigation-machine`  | décide de la phase et des libellés — pur, testé      |
 * | `lib/route-progress`      | projette la position sur le tracé — pur, testé       |
 * | **ce hook**               | ouvre et ferme l'abonnement, et rien d'autre         |
 *
 * Tout ce qui se calcule sans navigateur est calculé sans navigateur : il ne
 * reste ici que ce qu'on ne peut pas tester en `node`, c'est-à-dire le cycle de
 * vie de l'abonnement. C'est la même frontière que `use-route-overlay.ts` face
 * à `route-map-layers.ts`.
 *
 * ## Le consentement n'est pas redemandé, il est réutilisé
 *
 * Le guidage ne recueille **aucun accord de son côté** : il s'appuie sur le
 * portail déjà livré par UF-202/UF-802 (`useUserLocation`), avec ses deux
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
 * ## L'arrivée est le seul moment où le guidage parle au serveur (UF-807)
 *
 * Jusqu'à UF-806, ce hook n'écrivait rien : il lisait un itinéraire déjà reçu
 * et une position déjà consentie. Il publie désormais **un** événement, et un
 * seul — « arrivé » — parce que c'est lui qui distingue un trajet parcouru
 * d'une option cliquée, et donc ce que le suivi carbone a le droit de compter.
 * Il ne l'émet pas lui-même : il appelle `onArrival`, et c'est le planificateur
 * qui sait sur quelle ligne d'historique l'inscrire. Le guidage reste ainsi
 * sans requête réseau du début à la fin (C5).
 *
 * Couvre : C6 (suivi continu et échecs capteur), C8 (aucun consentement en
 * double), C5 (l'abonnement haute précision ne vit que dans les phases qui en
 * ont besoin).
 *
 * @param location État du parcours « Me localiser », tel que le planificateur le tient déjà
 * @param onArrival Appelé **une fois par session**, quand la destination est atteinte
 */
export interface NavigationController {
  state: NavigationState;
  /** `true` entre le clic sur « Démarrer » et l'arrivée de la première position. */
  awaitingConsent: boolean;
  /** Ouvre une session de guidage sur cet itinéraire (passe par le portail si besoin). */
  start: (itinerary: Itinerary) => void;
  /** Suspend le guidage — le GPS est relâché, le trajet est gardé. */
  pause: () => void;
  /** Reprend un guidage suspendu. */
  resume: () => void;
  /** Ferme la session et efface la progression. */
  stop: () => void;
}

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

  const { position, requestLocation } = location;

  // `requestLocation` passe par une ref : son identité change avec la session
  // (`useCallback` dépend d'`isGuest`), et `start` ne doit pas être recréé pour
  // autant — c'est un rappel posé sur un bouton de la liste de résultats.
  const requestLocationRef = useRef(requestLocation);
  requestLocationRef.current = requestLocation;

  const start = useCallback(
    (itinerary: Itinerary) => {
      // Position déjà consentie et connue : rien à demander, on guide.
      if (position) {
        dispatch({ type: 'start', itinerary });
        return;
      }
      setPending(itinerary);
      requestLocationRef.current();
    },
    [position],
  );

  // Le portail a abouti : la position promise est arrivée, le guidage démarre
  // sans que l'usager ait à recliquer sur « Démarrer ».
  useEffect(() => {
    if (!pending || !position) return;
    dispatch({ type: 'start', itinerary: pending });
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
  */
  useEffect(() => {
    if (state.phase !== 'arrived' || !state.itinerary) return;
    onArrivalRef.current?.(state.itinerary);
  }, [state.phase, state.itinerary]);

  /*
    Abonnement au capteur — ouvert et fermé par la seule phase.

    `needsPositionWatch` est la condition, et elle vit dans le module pur : le
    jour où une phase de plus s'ajoute, c'est un test `node` qui dit si le GPS
    doit tourner dedans, pas une relecture de cet effet.

    Le nettoyage est ce qui compte le plus ici (C5) : un abonnement haute
    précision oublié continue d'interroger le GPS après la fermeture de l'écran,
    et c'est exactement la fuite que `watchUserPosition` rend impossible à
    ignorer en renvoyant son propre arrêt.
  */
  const watching = needsPositionWatch(state.phase);
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

  return { state, awaitingConsent: pending !== null, start, pause, resume, stop };
}
