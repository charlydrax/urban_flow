'use client';

import { LazyMap } from '../../components/map/lazy-map';
import { toLngLat } from '../../lib/geolocation';
import { DEFAULT_ZOOM, LYON_CENTER } from '../../lib/map-style';
import { useSession } from '../auth/session-provider';
import { ItinerarySwitcher } from './itinerary-switcher';
import { PlannerForm } from './planner-form';
import { useRoutePlan } from './use-route-plan';
import { useSearchHistory } from './use-search-history';
import { useUserLocation } from './use-user-location';

/** Zoom appliqué au recentrage sur l'utilisateur : échelle « rue », lisible à pied. */
const LOCATED_ZOOM = 15;

/**
 * Écran du planificateur (F2) : formulaire, carte et choix d'itinéraire réunis.
 *
 * ## Pourquoi l'état vit ici
 *
 * Deux données sont **partagées** entre les enfants, et deux seulement :
 *
 * | Donnée                  | Producteur         | Consommateurs                                 |
 * | ----------------------- | ------------------ | --------------------------------------------- |
 * | Position (UF-202)       | `useUserLocation`  | formulaire (départ), carte (marqueur, centre) |
 * | Itinéraires (UF-403)    | `useRoutePlan`     | carte (tracés), sélecteur (choix)             |
 * | Trajets récents (UF-204)| `useSearchHistory` | formulaire (rappels), résultat de la recherche |
 *
 * Elles vivent donc au plus petit ancêtre commun — pas de contexte global pour
 * des données qui ne quittent pas cet écran, et qui, RGPD oblige, n'ont aucune
 * raison d'être disponibles ailleurs (C8).
 *
 * L'historique est remonté ici **depuis UF-403** : il était produit dans le
 * formulaire tant que c'était lui qui l'écrivait. Ce n'est plus le cas — c'est
 * la réponse de `POST /routes/plan` qui l'alimente maintenant, et cette réponse
 * arrive à cet étage.
 *
 * ## Ce qui se passe à la soumission (UF-403)
 *
 * ```
 * formulaire valide → useRoutePlan.plan(from, to)
 *                         │
 *                    POST /routes/plan   (l'API lit le profil, interroge les 3
 *                         │               sources, fusionne, calcule le CO₂ et
 *                         │               enregistre la recherche)
 *                         ▼
 *          itineraries[] + sortedBy + sources + searchHistoryId
 *                         │
 *          ┌──────────────┼───────────────────────┐
 *          ▼              ▼                       ▼
 *    tracés + repères  sélecteur          trajet récent remonté
 *    + cadrage carte   (recette 4)        en tête, sans requête
 * ```
 *
 * ## Repli sur Lyon
 *
 * Sans position — refus, échec GPS, ou simple absence de demande — la carte
 * reste centrée sur la métropole et l'écran fonctionne exactement comme avant.
 * Le cadrage sur un itinéraire, lui, prend le relais dès qu'il y en a un.
 *
 * Frontière client (C5/C10) : seul cet arbre est interactif ; la page reste un
 * Server Component, et MapLibre continue d'arriver en chargement différé.
 */
export function PlannerScreen() {
  const location = useUserLocation();
  const { position } = location;

  const { status: sessionStatus } = useSession();
  const history = useSearchHistory(sessionStatus === 'authenticated');

  // La recherche prévient l'historique dès que l'API confirme l'avoir écrite :
  // la liste des rappels remonte le trajet en tête sans un seul appel de plus.
  const routePlan = useRoutePlan(history.noteRecorded);

  const isEmptyResult = routePlan.status === 'ready' && routePlan.itineraries.length === 0;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
      <div className="flex flex-col gap-4">
        <PlannerForm
          location={location}
          history={history}
          onSubmitTrip={routePlan.plan}
          isSearching={routePlan.status === 'loading'}
        />

        {routePlan.error && (
          <p role="alert" className="rounded-md bg-tint-red px-3 py-2 text-sm text-error">
            {routePlan.error}
          </p>
        )}

        {/*
          Une liste vide est un **résultat**, pas une panne : le dire autrement
          enverrait l'usager vérifier sa connexion pour rien (C10). Le détail
          « quelles sources ont répondu » est l'objet d'UF-405.
        */}
        {isEmptyResult && (
          <p role="status" className="rounded-md bg-tint-gold px-3 py-2 text-sm text-ink-700">
            Aucun itinéraire ne relie ces deux points pour l’instant. Essayez une adresse plus
            proche d’un axe desservi.
          </p>
        )}

        <ItinerarySwitcher
          itineraries={routePlan.itineraries}
          selectedId={routePlan.selectedId}
          sortedBy={routePlan.sortedBy}
          onSelect={routePlan.select}
        />
      </div>

      {/*
        Tant qu'aucun itinéraire n'est tracé, la caméra suit la position (ou
        Lyon). Dès qu'il y en a un, `useRouteOverlay` prend la main par
        `fitBounds` : lui envoyer en plus un `center` recalculé ferait s'affronter
        deux mouvements de caméra sur la même frame.
      */}
      <LazyMap
        center={position ? toLngLat(position) : LYON_CENTER}
        zoom={position ? LOCATED_ZOOM : DEFAULT_ZOOM}
        userPosition={position}
        itineraries={routePlan.itineraries}
        selectedItineraryId={routePlan.selectedId}
        ariaLabel="Carte de la métropole de Lyon — les itinéraires calculés y sont tracés"
        textAlternative="Les itinéraires calculés sont également listés sous le formulaire, avec leur durée et leur empreinte carbone. Votre position, si vous l'avez partagée, est indiquée en toutes lettres sous le bouton « Me localiser »."
      />
    </div>
  );
}
