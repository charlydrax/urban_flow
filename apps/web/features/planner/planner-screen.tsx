'use client';

import type { Place } from '@urbanflow/shared';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { LazyMap } from '../../components/map/lazy-map';
import { toLngLat } from '../../lib/geolocation';
import { DEFAULT_ZOOM, LYON_CENTER } from '../../lib/map-style';
import {
  CACHED_ROUTE_NOTICE,
  GUEST_MODE_NOTICE,
  PLAN_FAILURE_NOTICES,
  SOURCE_LABELS,
  describeAppliedConstraints,
  describeDegradedSources,
  describeEmptyResult,
} from '../../lib/plan-feedback';
import { departureCard, stationCard } from '../../lib/realtime-cards';
import { describeSearchOptions, isEcoModeActive, type TripOptions } from '../../lib/trip-options';
import { useSession } from '../auth/session-provider';
import { NavigationScreen } from '../navigation/navigation-screen';
import { NavigationSheet } from '../navigation/navigation-sheet';
import { StartNavigation } from '../navigation/start-navigation';
import { useNavigation } from '../navigation/use-navigation';
import { CarbonBreakdown } from './carbon-breakdown';
import { ItineraryList } from './itinerary-list';
import { ItinerarySkeleton } from './itinerary-skeleton';
import { PlanNotice } from './plan-notice';
import { PlannerForm } from './planner-form';
import { RealtimeCards } from './realtime-cards';
import { useRealtimeContext } from './use-realtime-context';
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
  const { status: sessionStatus } = useSession();
  const isGuest = sessionStatus !== 'authenticated';

  // La session est lue AVANT la géolocalisation : depuis UF-802, « Me
  // localiser » n'emprunte pas le même chemin selon qu'il y a un compte ou non
  // (accord lu côté API, ou sur l'appareil — voir `useUserLocation`).
  const location = useUserLocation(isGuest);
  const { position } = location;

  const history = useSearchHistory(!isGuest);

  // La recherche prévient l'historique dès que l'API confirme l'avoir écrite :
  // la liste des rappels remonte le trajet en tête sans un seul appel de plus.
  const routePlan = useRoutePlan(history.noteRecorded);

  /*
    Départ de la **dernière recherche lancée** (UF-804), et non position de
    l'usager : les deux cartes temps réel annoncent « autour de votre départ »,
    et un trajet peut parfaitement commencer ailleurs qu'où l'on se trouve —
    c'est même le cas dès qu'on prépare un déplacement depuis chez soi.

    Retenu ici plutôt que dans `useRoutePlan` : le hook publie ce que le serveur
    a répondu, pas ce qu'on lui a demandé. Y ajouter la question fausserait sa
    frontière, alors que l'écran, lui, la connaît déjà — c'est lui qui la pose.
  */
  const [origin, setOrigin] = useState<Place | null>(null);

  // `plan` est extrait plutôt que lu sur `routePlan` dans le corps du rappel :
  // c'est une fonction d'identité stable (`useCallback` à dépendances vides),
  // mais la règle `exhaustive-deps` ne le voit pas à travers l'objet et
  // exigerait `routePlan` entier — donc un rappel recréé à chaque réponse, et
  // un formulaire rendu à nouveau pour rien (C5).
  const { plan } = routePlan;

  const handleSubmitTrip = useCallback(
    (from: Place, to: Place, options: TripOptions) => {
      setOrigin(from);
      plan(from, to, options);
    },
    [plan],
  );

  const realtime = useRealtimeContext(origin);

  /*
    Guidage (UF-806). Le contrôleur vit ici parce que c'est ici que se trouvent
    les deux choses dont il a besoin, et qu'il n'a aucune raison d'aller
    chercher ailleurs : l'itinéraire retenu et le parcours de consentement à la
    géolocalisation. Le monter plus haut aurait rendu un guidage disponible sur
    des écrans qui n'ont pas d'itinéraire à suivre.

    L'arrivée est rendue au planificateur (UF-807) : c'est lui qui tient la ligne
    d'historique de la recherche en cours, et donc le seul à savoir sur quoi
    inscrire « ce trajet a été parcouru ». Le guidage constate, le planificateur
    consigne — aucun des deux n'a besoin d'en savoir plus sur l'autre.
  */
  const { reportArrival } = routePlan;
  const navigation = useNavigation(location, reportArrival);

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
  const emptyNotice = isEmptyResult
    ? describeEmptyResult(routePlan.sources, routePlan.appliedConstraints)
    : null;
  // Le filtre PMR (UF-602) est annoncé dès qu'une réponse est là, liste pleine
  // ou vide : c'est ce qui relie les options affichées à la case cochée dans le
  // profil, peut-être des semaines plus tôt et sur une autre page (C7/C12).
  // Sur une liste vide, le message de `describeEmptyResult` le dit déjà — et
  // mieux, puisqu'il explique le vide : les afficher tous les deux ferait lire
  // deux fois la même contrainte.
  const constraintNotice =
    routePlan.status === 'ready' && !isEmptyResult
      ? describeAppliedConstraints(routePlan.appliedConstraints)
      : null;
  const degraded = routePlan.status === 'ready' ? describeDegradedSources(routePlan.sources) : null;

  // Le détail carbone (UF-501) porte sur l'option retenue, et sur elle seule :
  // déplier les quatre en même temps repousserait la comparaison hors de
  // l'écran, alors que c'est elle que le panneau sert (C2).
  const selectedItinerary =
    routePlan.itineraries.find((itinerary) => itinerary.id === routePlan.selectedId) ?? null;

  /*
    Les deux cartes temps réel (UF-804) sont **dérivées**, jamais stockées :
    elles changent dès que l'usager retient une autre option, et les tenir en
    état obligerait à les resynchroniser à chaque clic. Une carte absente —
    aucune borne louante, ou une option sans transport en commun — sort d'ici
    en `null` et n'occupe alors aucune place à l'écran.
  */
  const realtimeCards = [
    stationCard(realtime.stations, realtime.statuses),
    departureCard(selectedItinerary, realtime.statuses),
  ].filter((card) => card !== null);

  // Contraintes que l'usager vient de poser lui-même (UF-804) : elles se
  // défont à l'endroit où elles ont été posées, quelques lignes plus haut. Le
  // filtre PMR (UF-602), lui, se règle dans le profil — les deux messages
  // coexistent parce qu'ils n'appellent pas la même action.
  const searchOptionsNotice =
    routePlan.status === 'ready' ? describeSearchOptions(routePlan.appliedConstraints) : null;

  /*
    `min-w-0` sur les DEUX colonnes, et pas seulement sur la grille (UF-606, C2).

    Un élément de grille a un `min-width: auto` implicite : sa piste ne descend
    jamais sous la **taille min-content** de son contenu. Or cette colonne
    contient des libellés d'adresses en `truncate` (`white-space: nowrap`, donc
    min-content = largeur du texte entier) et l'autre un `<canvas>` MapLibre, qui
    porte une largeur intrinsèque. Sans ce plancher à zéro, la piste unique du
    mode mobile s'élargissait à la plus longue adresse de l'historique — 489 px
    mesurés sur un écran de 375 px, soit toute la page qui défilait
    horizontalement, en-tête et pied de page compris.

    Ce n'est pas un détail cosmétique : c'est ce qui rend le `truncate` effectif.
    Tant que la piste s'élargissait, l'ellipse ne se déclenchait jamais.
  */
  /*
    En guidage, l'écran de navigation **remplace** le planificateur au lieu de
    s'ajouter dessous : la maquette « 6. NAVIGATION » est un plein cadre, et
    laisser le formulaire et la liste défiler sous la carte inviterait à lancer
    une autre recherche pendant qu'on suit un trajet.

    Le planificateur n'est pas démonté pour autant — il reprend exactement où il
    en était à la sortie du guidage : mêmes résultats, même sélection, sans un
    seul appel réseau de plus (C5/C10).
  */
  if (navigation.state.phase !== 'idle') {
    return (
      <NavigationScreen state={navigation.state}>
        {(following, followAgain) => (
          <NavigationSheet
            state={navigation.state}
            following={following}
            onFollowAgain={followAgain}
            onPause={navigation.pause}
            onResume={navigation.resume}
            onStop={navigation.stop}
          />
        )}
      </NavigationScreen>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <PlannerForm
          location={location}
          history={history}
          onSubmitTrip={handleSubmitTrip}
          isSearching={isSearching}
          ecoModeActive={isEcoModeActive(routePlan.sortedBy)}
          isGuest={isGuest}
        />

        {/*
          Visiteur sans compte (UF-801) : le planificateur fonctionne
          entièrement, seule la mémoire manque. La note est posée **avant** les
          messages de recherche parce qu'elle qualifie l'écran entier et non un
          résultat, et elle reste affichée en permanence : le visiteur doit
          l'avoir sous les yeux au moment où il constate l'absence de trajets
          récents, pas seulement à l'ouverture de la page.
        */}
        {isGuest && (
          <PlanNotice tone="info" role={GUEST_MODE_NOTICE.role} message={GUEST_MODE_NOTICE.message}>
            <p>
              <Link href="/login" className="font-semibold underline underline-offset-2">
                Connectez-vous
              </Link>{' '}
              pour retrouver vos trajets et suivre votre impact CO₂.
            </p>
          </PlanNotice>
        )}

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
          Filtre d'accessibilité actif (UF-602) : ton `info`, pas `warning` — la
          contrainte fait exactement ce qu'on lui demande, il n'y a rien à
          corriger. Le peindre en orange ferait chercher un problème dans un
          réglage volontaire.
        */}
        {constraintNotice && (
          <PlanNotice tone="info" role={constraintNotice.role} message={constraintNotice.message} />
        )}

        {/*
          Options de recherche restrictives (UF-804) : ton `info` pour la même
          raison que le filtre PMR — un mode décoché fait exactement ce qu'on
          lui demande. La note est posée sous celle du profil parce qu'elle est
          plus facile à défaire : le réglage est à l'écran, deux blocs plus haut.
        */}
        {searchOptionsNotice && (
          <PlanNotice tone="info" role="status" message={searchOptionsNotice} />
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
            {/*
              « Démarrer » avant le détail carbone : c'est l'action qui suit le
              choix qu'on vient de faire, alors que le détail est une
              justification qu'on ouvre si on la veut. La reléguer sous un bloc
              dépliable ferait chercher le maillon principal du parcours.
            */}
            {selectedItinerary && (
              <StartNavigation
                itinerary={selectedItinerary}
                awaitingConsent={navigation.awaitingConsent}
                onStart={navigation.start}
              />
            )}

            {selectedItinerary && <CarbonBreakdown itinerary={selectedItinerary} />}

            {/*
              Les deux encarts « données F3 » ferment la colonne, comme sur la
              planche : ils complètent le choix qui vient d'être fait, ils ne le
              précèdent pas. Les poser au-dessus de la liste ferait lire une
              disponibilité de bornes avant d'avoir vu les itinéraires qu'elle
              sert à comparer.
            */}
            <RealtimeCards cards={realtimeCards} />
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
