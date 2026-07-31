'use client';

import { LazyMap } from '../../components/map/lazy-map';
import { toLngLat } from '../../lib/geolocation';
import { DEFAULT_ZOOM, LYON_CENTER } from '../../lib/map-style';
import { PlannerForm } from './planner-form';
import { useUserLocation } from './use-user-location';

/** Zoom appliqué au recentrage sur l'utilisateur : échelle « rue », lisible à pied. */
const LOCATED_ZOOM = 15;

/**
 * Écran du planificateur (F2) : formulaire et carte réunis (UF-202).
 *
 * Ce composant existe pour **partager la position** entre les deux : le
 * formulaire pré-remplit son départ, la carte pose le marqueur et se recentre.
 * L'état vit ici, au plus près du plus petit ancêtre commun — pas de contexte
 * global pour une donnée qui ne quitte pas cet écran (et qui, RGPD oblige, n'a
 * aucune raison d'être disponible ailleurs).
 *
 * **Repli sur Lyon** (recette 2 du ticket) : sans position — refus, échec GPS,
 * ou simple absence de demande — la carte reste centrée sur la métropole et
 * l'écran fonctionne exactement comme avant.
 *
 * Frontière client (C5/C10) : seul cet arbre est interactif ; la page reste un
 * Server Component, et MapLibre continue d'arriver en chargement différé.
 */
export function PlannerScreen() {
  const location = useUserLocation();
  const { position } = location;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
      <PlannerForm location={location} />
      <LazyMap
        center={position ? toLngLat(position) : LYON_CENTER}
        zoom={position ? LOCATED_ZOOM : DEFAULT_ZOOM}
        userPosition={position}
        ariaLabel="Carte de la métropole de Lyon — les itinéraires calculés y seront tracés"
        textAlternative="Les itinéraires calculés sont également listés sous le formulaire, triés par empreinte carbone croissante. Votre position, si vous l'avez partagée, est indiquée en toutes lettres sous le bouton « Me localiser »."
      />
    </div>
  );
}
