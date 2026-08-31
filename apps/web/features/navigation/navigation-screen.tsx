'use client';

import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { LazyMap } from '../../components/map/lazy-map';
import { LYON_CENTER } from '../../lib/map-style';
import type { NavigationState } from '../../lib/navigation-machine';

/**
 * Zoom du guidage : échelle « rue », celle de la maquette « 6. NAVIGATION ».
 *
 * Plus rapproché que le `LOCATED_ZOOM` (15) du planificateur, qui sert à situer
 * un quartier de départ : en guidage, ce qu'on cherche à voir est le prochain
 * carrefour, pas la moitié de l'arrondissement.
 */
const NAVIGATION_ZOOM = 17;

export interface NavigationScreenProps {
  state: NavigationState;
  /**
   * Panneau de guidage — passé en fonction parce que l'état de la caméra vit
   * ici, alors que le bouton qui le pilote est dans le panneau. Un composant
   * enfant figé aurait obligé à remonter `following` d'un cran plus haut, où
   * personne d'autre n'en a l'usage.
   */
  children: (following: boolean, followAgain: () => void) => ReactNode;
}

/**
 * Écran de guidage (UF-806) — carte plein cadre surmontée du panneau, d'après
 * la maquette « 6. NAVIGATION ».
 *
 * ## Le mode caméra « qui suit »
 *
 * La caméra est recentrée sur la **position projetée sur le tracé**, et non sur
 * la position brute du capteur : à ± 30 m, le point brut saute d'un trottoir à
 * l'autre et la carte tremble à chaque mesure. Le point accroché au tracé, lui,
 * avance le long de l'itinéraire — c'est aussi ce que la planche dessine, un
 * rond posé sur le trait.
 *
 * Le suivi se **désengage dès que l'usager déplace la carte lui-même** : on
 * regarde souvent la suite du trajet en cours de route, et une caméra qui
 * ramènerait de force au point courant une demi-seconde plus tard rendrait ce
 * geste impossible. Le bouton « ↗ » du panneau le réengage — c'est le rôle que
 * la planche donne à ce carré.
 *
 * Un **seul** chemin commande la caméra : le `center` passé à `MapView`, qui
 * cesse simplement d'être rafraîchi quand le suivi est coupé. Ajouter ici un
 * `easeTo` de plus aurait fait bouger la caméra deux fois par mesure, et
 * dupliqué la prise en charge de `prefers-reduced-motion` que `MapView` assure
 * déjà (C7).
 *
 * ## Pourquoi ce n'est pas une route Next à part
 *
 * L'itinéraire suivi est un objet reçu de `POST /routes/plan`, avec ses
 * géométries par segment. Une route dédiée obligerait soit à le sérialiser dans
 * l'URL (des kilo-octets de coordonnées), soit à le stocker, soit à relancer un
 * calcul — qui pourrait rendre un itinéraire *différent* de celui que l'usager
 * a retenu. Le guidage se superpose donc au planificateur, qui le tient déjà en
 * mémoire, et le quitter rend la liste de résultats intacte.
 *
 * Couvre : C2 (carte plein cadre, panneau bas atteignable au pouce), C5 (aucune
 * requête réseau pendant tout le guidage), C6, C7.
 */
export function NavigationScreen({ state, children }: NavigationScreenProps) {
  const [following, setFollowing] = useState(true);

  /**
   * Dernier point sur lequel la caméra a été envoyée.
   *
   * En état, et **figé dès que le suivi est coupé** : c'est ce qui laisse la
   * carte là où l'usager l'a posée. Repasser `undefined` la renverrait au
   * centre par défaut (Lyon), c'est-à-dire très loin de ce qu'il regardait.
   */
  const [camera, setCamera] = useState<[number, number] | null>(null);

  const mapRef = useRef<MapLibreMap | null>(null);

  /*
    Désengagement au premier geste de l'usager.

    `dragstart` et `zoomstart` seulement — et surtout **pas** `move`, qui est
    aussi émis par les `easeTo` de la carte elle-même : le suivi se couperait
    alors tout seul au premier recentrage qu'il déclenche. Ces deux
    événements-ci ne partent que d'une interaction.
  */
  const handleMapReady = useCallback((map: MapLibreMap) => {
    mapRef.current = map;
    const release = () => setFollowing(false);
    map.on('dragstart', release);
    map.on('zoomstart', release);
  }, []);

  const followAgain = useCallback(() => setFollowing(true), []);

  const snapped = state.progress?.snapped ?? state.position ?? null;

  useEffect(() => {
    if (!following || !snapped) return;
    setCamera([snapped.lng, snapped.lat]);
  }, [following, snapped]);

  return (
    <div className="flex flex-col">
      <LazyMap
        className="h-[52vh] min-h-[280px] min-w-0 md:h-[560px]"
        userPosition={
          // Le marqueur est posé sur le tracé plutôt que sur la mesure brute —
          // même raison que la caméra. La précision annoncée reste celle du
          // capteur : c'est elle que le marqueur énonce, et l'accrochage au
          // tracé ne l'améliore pas (C6).
          state.position && state.progress
            ? { ...state.progress.snapped, accuracyMeters: state.position.accuracyMeters }
            : state.position
        }
        center={camera ?? LYON_CENTER}
        zoom={camera ? NAVIGATION_ZOOM : undefined}
        itineraries={state.itinerary ? [state.itinerary] : []}
        selectedItineraryId={state.itinerary?.id ?? null}
        // La caméra est pilotée ici, par la position : laisser le cadrage sur
        // l'itinéraire entier ferait s'affronter deux mouvements par mesure.
        fitSelectedRoute={false}
        onReady={handleMapReady}
        ariaLabel="Carte de guidage — votre position et le tracé de l’itinéraire suivi"
        textAlternative="Le détail de l’étape en cours, l’heure d’arrivée estimée et les commandes du guidage sont sous la carte."
      />

      {children(following, followAgain)}
    </div>
  );
}
