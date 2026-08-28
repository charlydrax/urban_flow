'use client';

import { LazyMap } from '../../components/map/lazy-map';
import { toLngLat } from '../../lib/geolocation';
import { DEFAULT_ZOOM, LYON_CENTER } from '../../lib/map-style';
import {
  CACHED_ROUTE_NOTICE,
  PLAN_FAILURE_NOTICES,
  SOURCE_LABELS,
  describeDegradedSources,
  describeEmptyResult,
} from '../../lib/plan-feedback';
import { useSession } from '../auth/session-provider';
import { CarbonBreakdown } from './carbon-breakdown';
import { ItineraryList } from './itinerary-list';
import { ItinerarySkeleton } from './itinerary-skeleton';
import { PlanNotice } from './plan-notice';
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
 * | Itinéraires (UF-403)    | `useRoutePlan`     | carte (tracés), panneau de résultats (choix)  |
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
 *    tracés + repères  panneau de         trajet récent remonté
 *    + cadrage carte   résultats (UF-404) en tête, sans requête
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

  const isSearching = routePlan.status === 'loading';
  const isEmptyResult = routePlan.status === 'ready' && routePlan.itineraries.length === 0;

  // Trois messages possibles, jamais deux à la fois (UF-405) : l'échec exclut
  // le résultat, et la panne totale des sources est déjà dite par le message de
  // liste vide — `describeDegradedSources` rend `null` dans ce cas.
  const failureNotice = routePlan.failure ? PLAN_FAILURE_NOTICES[routePlan.failure] : null;
  // Ni `session-expired` ni `offline` ne sont des pannes : la première est déjà
  // suivie d'une redirection, la seconde est un état de l'appareil qu'aucune
  // relance ne corrigera. Les peindre en rouge ferait chercher un problème là
  // où il n'y en a pas (C7).
  const failureTone =
    routePlan.failure === 'session-expired'
      ? 'info'
      : routePlan.failure === 'offline'
        ? 'warning'
        : 'error';
  const emptyNotice = isEmptyResult ? describeEmptyResult(routePlan.sources) : null;
  const degraded = routePlan.status === 'ready' ? describeDegradedSources(routePlan.sources) : null;

  // Le détail carbone (UF-501) porte sur l'option retenue, et sur elle seule :
  // déplier les quatre en même temps repousserait la comparaison hors de
  // l'écran, alors que c'est elle que le panneau sert (C2).
  const selectedItinerary =
    routePlan.itineraries.find((itinerary) => itinerary.id === routePlan.selectedId) ?? null;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
      <div className="flex flex-col gap-4">
        <PlannerForm
          location={location}
          history={history}
          onSubmitTrip={routePlan.plan}
          isSearching={isSearching}
        />

        {/*
          La session expirée n'est pas peinte comme une panne : la redirection
          vers /login est déjà lancée (UF-106), le message l'explique.
        */}
        {failureNotice && (
          <PlanNotice
            tone={failureTone}
            role={failureNotice.role}
            message={failureNotice.message}
          />
        )}

        {/*
          Résultats rejoués depuis le cache du service worker (UF-601) : ils
          répondent à la recherche PRÉCÉDENTE. Le dire est la seule chose qui
          sépare une dégradation gracieuse d'un mensonge à l'écran (C10).
        */}
        {routePlan.servedFromCache && (
          <PlanNotice
            tone="warning"
            role={CACHED_ROUTE_NOTICE.role}
            message={CACHED_ROUTE_NOTICE.message}
          />
        )}

        {/*
          Une liste vide est un **résultat**, pas une panne : le dire autrement
          enverrait l'usager vérifier sa connexion pour rien (C10). Sauf quand
          les trois sources se sont tues — et c'est `sources[]` qui le dit.
        */}
        {emptyNotice && (
          <PlanNotice
            tone={emptyNotice.role === 'alert' ? 'error' : 'info'}
            role={emptyNotice.role}
            message={emptyNotice.message}
          />
        )}

        {/*
          Mode dégradé (C10) : une source absente sur trois n'empêche pas de se
          déplacer avec les autres. La note est discrète et ne bloque rien —
          elle est posée **au-dessus** de la liste, parce qu'elle qualifie ce
          qu'on va lire dessous.
        */}
        {degraded && (
          <PlanNotice tone="warning" role="status" message={degraded.message}>
            <p className="text-xs">
              Sources indisponibles&nbsp;:{' '}
              {degraded.missing.map((source) => SOURCE_LABELS[source]).join(', ')}.
            </p>
          </PlanNotice>
        )}

        {isSearching ? (
          <ItinerarySkeleton />
        ) : (
          <>
            <ItineraryList
              itineraries={routePlan.itineraries}
              selectedId={routePlan.selectedId}
              sortedBy={routePlan.sortedBy}
              onSelect={routePlan.select}
            />

            {/*
              Sous la liste et non dans la carte : une carte de résultat est un
              `<label>` de bouton radio, et y imbriquer un `<summary>` cliquable
              ferait changer la sélection à chaque ouverture du détail.
            */}
            {selectedItinerary && <CarbonBreakdown itinerary={selectedItinerary} />}
          </>
        )}
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
