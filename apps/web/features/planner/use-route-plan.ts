'use client';

import type {
  AppliedRouteConstraints,
  Itinerary,
  ItinerarySortKey,
  Place,
  SearchHistoryPlace,
  SourceAvailability,
} from '@urbanflow/shared';
import { useCallback, useRef, useState } from 'react';

import { apiClient } from '../../lib/api-client';
import { classifyPlanFailure, type PlanFailureKind } from '../../lib/plan-feedback';
import { toPlanOptions, type TripOptions } from '../../lib/trip-options';

/**
 * Les échecs qui font vraiment échouer l'écran — tout sauf `no-route`, qui est
 * un résultat vide et sort donc en `ready`.
 */
type PlanFailure = Exclude<PlanFailureKind, 'no-route'>;

/**
 * Cycle de vie d'une recherche d'itinéraires.
 *
 * - `idle` — aucune recherche lancée depuis l'ouverture de l'écran
 * - `loading` — `POST /routes/plan` en vol
 * - `ready` — réponse reçue (la liste peut être **vide** : c'est un résultat, pas une panne)
 * - `error` — l'API n'a pas répondu, ou a répondu une erreur
 */
export type RoutePlanStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RoutePlanState {
  status: RoutePlanStatus;
  /** Itinéraires renvoyés, déjà triés par le serveur selon la priorité du profil. */
  itineraries: Itinerary[];
  /** Clé de tri appliquée par le serveur — publiée pour être annoncée telle quelle. */
  sortedBy: ItinerarySortKey | null;
  /** État des trois sources pour cette recherche (UF-305) — alimente le bandeau « mode dégradé ». */
  sources: SourceAvailability[];
  /**
   * Contraintes du profil qui ont réduit cette liste (UF-602) — alimente la
   * note « filtre accessibilité actif ».
   *
   * `null` tant qu'aucune réponse n'est arrivée, **et** quand la réponse vient
   * d'un cache antérieur au ticket : dans les deux cas on ne sait rien, et
   * affirmer « aucun filtre » serait une affirmation de trop.
   */
  appliedConstraints: AppliedRouteConstraints | null;
  /** Itinéraire mis en avant sur la carte. */
  selectedId: string | null;
  /**
   * `true` quand les itinéraires affichés viennent du **cache hors-ligne** du
   * service worker et non d'un calcul (UF-601).
   *
   * Publié comme un drapeau et non comme un message : c'est l'écran qui
   * affiche, et `lib/plan-feedback.ts` qui rédige — même partage que `failure`.
   */
  servedFromCache: boolean;
  /**
   * Nature de l'échec quand `status` vaut `error`, `null` sinon (UF-405).
   *
   * Le hook publie la **nature**, pas le texte : c'est l'écran qui affiche, et
   * `lib/plan-feedback.ts` qui décide de ce qui se dit et sur quel ton. Un hook
   * qui rendrait une phrase toute faite rendrait ce choix intestable sans React.
   *
   * `no-route` en est **exclu par le type** : un « aucun trajet » sort en
   * `ready` avec une liste vide, jamais en `error`. Le dire au compilateur
   * dispense l'écran de traiter un cas qui ne peut pas se produire.
   */
  failure: PlanFailure | null;
  /**
   * Lance une recherche ; annule silencieusement celle qui serait encore en vol.
   *
   * `options` porte les réglages de l'écran (UF-804) : heure de départ, taille
   * du groupe, modes retenus. Il est **facultatif** — un appelant qui n'en
   * passe pas envoie exactement la requête d'avant le ticket, `{ from, to }`
   * et rien d'autre.
   */
  plan: (from: Place, to: Place, options?: TripOptions) => void;
  /** Change l'itinéraire mis en avant (recette 4 du ticket). */
  select: (itineraryId: string) => void;
}

/**
 * Prévenu quand l'API a enregistré la recherche (étape 18 du flux).
 *
 * Le hook rend l'identifiant **et** les deux extrémités : la réponse ne contient
 * que le premier, et l'appelant qui entretient la liste des trajets récents a
 * besoin des trois pour poser la ligne sans relire la collection (C5).
 */
type SearchRecordedHandler = (
  searchHistoryId: string,
  from: SearchHistoryPlace,
  to: SearchHistoryPlace,
) => void;

/**
 * Un `Place` du planificateur devient une extrémité d'historique **seulement**
 * s'il porte ses coordonnées : la table est en géométrie PostGIS, un point
 * manquant n'y a pas de place. En pratique le formulaire l'exige déjà avant de
 * soumettre — cette garde couvre le cas où un futur appelant serait moins strict.
 */
function toHistoryPlace(place: Place): SearchHistoryPlace | null {
  if (place.lat === undefined || place.lng === undefined) return null;
  return { label: place.label, lat: place.lat, lng: place.lng };
}

/**
 * Recherche d'itinéraires multimodaux (F2) — étapes 1 et 8 du flux de référence.
 *
 * ## Ce que le hook ne fait pas
 *
 * Il ne trie pas, ne recalcule pas l'empreinte, n'enregistre pas l'historique.
 * Le serveur fait les trois (UF-401/UF-402) et **publie** ce qu'il a fait
 * (`sortedBy`, `searchHistoryId`) : rejouer ces décisions côté client, c'est
 * garantir qu'un jour les deux divergeront.
 *
 * ## Sélection par défaut
 *
 * Le premier itinéraire de la liste est sélectionné d'office, parce que le
 * serveur l'a placé là : c'est le meilleur selon la priorité du profil. Ouvrir
 * l'écran sur une carte vide en attendant un clic ferait porter à l'usager une
 * décision qui est déjà prise.
 *
 * ## Concurrence
 *
 * Une recherche relancée avant la fin de la précédente **écarte** la réponse
 * périmée : sans ce garde-fou, une première réponse lente écraserait une seconde
 * plus rapide, et l'écran afficherait le trajet précédent. Le compteur suffit,
 * l'`AbortController` n'ajouterait qu'une annulation réseau — utile, mais le
 * corps est déjà en route quand le cas se produit.
 *
 * ## Cas non nominaux (UF-405)
 *
 * ```
 * 200 + liste pleine  → ready   (+ bandeau « mode dégradé » si une source manque)
 * 200 + liste vide    → ready   (« aucun trajet », ou « aucune source n'a répondu »)
 * 404                 → ready   avec une liste vide — voir plus bas
 * 401                 → error   `session-expired` ; SessionProvider redirige (UF-106)
 * 400 / 5xx / réseau  → error
 * hors-ligne, cache   → ready   avec `servedFromCache` (UF-601)
 * hors-ligne, à vide  → error   `offline` — rien à réessayer avant le réseau
 * ```
 *
 * Les deux dernières lignes viennent du **service worker**, pas de l'API : hors
 * réseau, il intercepte `POST /routes/plan` et rejoue le dernier itinéraire
 * mémorisé (marqué par un en-tête), ou fabrique un `503` s'il n'en a aucun.
 * Le hook n'a donc rien de particulier à faire pour être utilisable hors-ligne
 * — il lui suffit de **dire** d'où viennent ses résultats.
 *
 * Un **404 est traité comme un résultat vide**, pas comme une panne. Notre API
 * ne le renvoie pas (elle répond `200` + liste vide + état des sources, plus
 * riche), mais le diagramme de séquence prévoit cette branche et un
 * intermédiaire réseau peut la produire : la faire tomber dans le cas d'erreur
 * afficherait « vérifiez votre connexion » à quelqu'un dont la recherche a
 * simplement abouti à rien.
 *
 * Sur **401**, le hook n'affiche pas moins qu'ailleurs mais autre chose : le
 * message dit la redirection en cours au lieu d'accuser le réseau. La purge de
 * session et la navigation restent l'affaire de `SessionProvider`, prévenu par
 * l'intercepteur du client API — ce hook ne connaît pas le routeur.
 *
 * @param onSearchRecorded Prévenu quand l'API a écrit la recherche dans
 * l'historique. Non appelé si `searchHistoryId` est `null` : l'écriture a
 * échoué côté serveur, et c'est un désagrément, pas une panne de la recherche (C10).
 */
export function useRoutePlan(onSearchRecorded?: SearchRecordedHandler): RoutePlanState {
  const [status, setStatus] = useState<RoutePlanStatus>('idle');
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [sortedBy, setSortedBy] = useState<ItinerarySortKey | null>(null);
  const [sources, setSources] = useState<SourceAvailability[]>([]);
  const [appliedConstraints, setAppliedConstraints] = useState<AppliedRouteConstraints | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failure, setFailure] = useState<PlanFailure | null>(null);
  const [servedFromCache, setServedFromCache] = useState(false);

  /** Numéro de la dernière recherche lancée — seule sa réponse a le droit d'écrire. */
  const requestIdRef = useRef(0);

  /**
   * Ligne d'historique de la recherche en cours, sur laquelle inscrire le choix
   * de l'usager (UF-505). `null` quand l'API n'a pas pu écrire l'historique :
   * il n'y a alors rien à compléter, et ce n'est pas une panne de la recherche.
   */
  const searchHistoryIdRef = useRef<string | null>(null);

  /** Itinéraires de la réponse en cours, pour retrouver les segments d'un choix. */
  const itinerariesRef = useRef<Itinerary[]>([]);
  itinerariesRef.current = itineraries;

  // Le rappel passe par une ref : un appelant qui le recrée à chaque rendu ne
  // doit pas faire changer l'identité de `plan`, dont dépendent des `useCallback`
  // en amont.
  const onSearchRecordedRef = useRef(onSearchRecorded);
  onSearchRecordedRef.current = onSearchRecorded;

  const plan = useCallback((from: Place, to: Place, options?: TripOptions) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setStatus('loading');
    setFailure(null);
    setServedFromCache(false);

    // La réponse précédente est écartée **dès le départ** de la nouvelle
    // recherche, et pas seulement à l'arrivée de la suivante : laisser les
    // anciens itinéraires à l'écran pendant le calcul afficherait un squelette
    // dans le panneau et d'anciens tracés sur la carte au même instant, et
    // rendrait cliquable une option qui ne répond plus à la question posée.
    setItineraries([]);
    setSortedBy(null);
    setSources([]);
    setAppliedConstraints(null);
    setSelectedId(null);
    // La ligne d'historique de la recherche précédente n'a plus cours : un clic
    // arrivé après le lancement d'une nouvelle recherche ne doit pas inscrire
    // son choix sur l'ancien trajet (UF-505).
    searchHistoryIdRef.current = null;

    // `toPlanOptions` n'ajoute que les champs qui **contraignent** : une
    // recherche laissée sur ses valeurs par défaut produit `{ from, to }`, le
    // corps exact d'avant UF-804. C'est ce qui garantit qu'ouvrir l'écran ne
    // change pas la requête, et que le serveur ne publiera pas un filtre que
    // personne n'a posé.
    void apiClient
      .planRoutes({ from, to, ...(options ? toPlanOptions(options) : {}) })
      .then(({ response, servedFromCache: fromCache }) => {
        if (requestIdRef.current !== requestId) return;

        setItineraries(response.itineraries);
        setSortedBy(response.sortedBy);
        setSources(response.sources);
        // `?? null` et non `?? { reducedMobility: false }` : une réponse rejouée
        // depuis un cache antérieur à UF-602 n'a pas le champ, et lui prêter
        // « aucun filtre » masquerait un filtre peut-être bien actif (C10).
        setAppliedConstraints(response.appliedConstraints ?? null);
        setSelectedId(response.itineraries[0]?.id ?? null);
        setStatus('ready');
        setServedFromCache(fromCache);

        // Une réponse rejouée depuis le cache hors-ligne porte le
        // `searchHistoryId` de la recherche **précédente** (UF-601). S'en
        // servir inscrirait le choix de l'usager sur un trajet qu'il n'a pas
        // demandé, et fausserait son bilan carbone ; la recherche courante,
        // elle, n'a jamais atteint l'API et n'existe donc pas en base.
        if (fromCache) {
          searchHistoryIdRef.current = null;
          return;
        }

        searchHistoryIdRef.current = response.searchHistoryId;

        const historyFrom = toHistoryPlace(from);
        const historyTo = toHistoryPlace(to);
        if (response.searchHistoryId && historyFrom && historyTo) {
          onSearchRecordedRef.current?.(response.searchHistoryId, historyFrom, historyTo);
        }
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) return;

        // Les résultats de la recherche précédente n'ont plus cours : les
        // laisser à l'écran ferait passer un trajet périmé pour la réponse à
        // la question qu'on vient de poser.
        setItineraries([]);
        setSelectedId(null);
        setSortedBy(null);

        // `navigator.onLine` distingue « nos serveurs n'ont pas répondu » de
        // « cet appareil n'a plus de réseau » : les deux ne se disent pas
        // pareil, et inviter à vérifier une connexion qu'on sait absente
        // n'aide personne (UF-601).
        const kind = classifyPlanFailure(error, { online: navigator.onLine });
        if (kind === 'no-route') {
          // « Aucun trajet » n'est pas une panne. Sans corps de réponse, on ne
          // sait pas quelles sources ont parlé : `sources` reste vide, et le
          // message se rabat sur sa formulation neutre.
          setSources([]);
          setAppliedConstraints(null);
          setStatus('ready');
          return;
        }

        // Le 401 « session morte » est déjà pris en charge globalement par
        // `SessionProvider` (UF-106) : le hook se contente d'en publier la
        // nature, sans exposer le statut ni le détail renvoyé par l'API (C11).
        setSources([]);
        setAppliedConstraints(null);
        setFailure(kind);
        setStatus('error');
      });
  }, []);

  /**
   * Retient un itinéraire : la carte le met en avant, et l'API l'inscrit sur la
   * ligne d'historique de la recherche (UF-505).
   *
   * ## Pourquoi seul un clic compte
   *
   * La première option est présélectionnée à l'arrivée des résultats — c'est un
   * classement du serveur, pas une décision. Elle n'est donc **pas** enregistrée :
   * le suivi carbone doit compter des déplacements, pas des suggestions, et un
   * bilan gonflé de trajets que personne n'a faits ne vaudrait rien. Seul le
   * passage par cette fonction, déclenchée par le groupe de boutons radio,
   * inscrit un choix.
   *
   * ## L'enregistrement ne doit jamais gêner la sélection
   *
   * La mise en avant est appliquée **avant** l'appel réseau et ne l'attend pas :
   * une carte qui ne s'allumerait qu'après un aller-retour serait une régression
   * d'interface. Un échec d'écriture est silencieux — ne pas comptabiliser un
   * trajet est un désagrément, l'annoncer comme une panne en serait une vraie
   * (dégradation gracieuse — C10). C'est la même règle que pour l'écriture de
   * l'historique elle-même.
   *
   * Le corps ne porte **aucun gramme** : seulement le résumé de l'option et les
   * couples (mode, distance) de ses segments. L'empreinte est calculée par le
   * Service Carbone, côté serveur (C4).
   */
  const select = useCallback((itineraryId: string) => {
    setSelectedId(itineraryId);

    const searchHistoryId = searchHistoryIdRef.current;
    const chosen = itinerariesRef.current.find((itinerary) => itinerary.id === itineraryId);
    if (!searchHistoryId || !chosen) return;

    void apiClient
      .recordItinerarySelection(searchHistoryId, {
        selectedSummary: chosen.summary,
        segments: chosen.segments.map((segment) => ({
          mode: segment.mode,
          // Le serveur valide des entiers : une distance fractionnaire venue
          // d'une source externe serait refusée en 400 pour rien.
          distanceMeters: Math.round(Math.max(0, segment.distanceMeters)),
        })),
      })
      .catch(() => {
        // Volontairement muet — voir la docstring. Un 401 est déjà traité
        // globalement par `SessionProvider`.
      });
  }, []);

  return {
    status,
    itineraries,
    sortedBy,
    sources,
    appliedConstraints,
    selectedId,
    servedFromCache,
    failure,
    plan,
    select,
  };
}
