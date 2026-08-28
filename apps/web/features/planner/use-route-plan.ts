'use client';

import type {
  Itinerary,
  ItinerarySortKey,
  Place,
  SearchHistoryPlace,
  SourceAvailability,
} from '@urbanflow/shared';
import { useCallback, useRef, useState } from 'react';

import { apiClient } from '../../lib/api-client';
import { classifyPlanFailure, type PlanFailureKind } from '../../lib/plan-feedback';

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
  /** Itinéraire mis en avant sur la carte. */
  selectedId: string | null;
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
  /** Lance une recherche ; annule silencieusement celle qui serait encore en vol. */
  plan: (from: Place, to: Place) => void;
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
 * ```
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failure, setFailure] = useState<PlanFailure | null>(null);

  /** Numéro de la dernière recherche lancée — seule sa réponse a le droit d'écrire. */
  const requestIdRef = useRef(0);

  // Le rappel passe par une ref : un appelant qui le recrée à chaque rendu ne
  // doit pas faire changer l'identité de `plan`, dont dépendent des `useCallback`
  // en amont.
  const onSearchRecordedRef = useRef(onSearchRecorded);
  onSearchRecordedRef.current = onSearchRecorded;

  const plan = useCallback((from: Place, to: Place) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setStatus('loading');
    setFailure(null);

    // La réponse précédente est écartée **dès le départ** de la nouvelle
    // recherche, et pas seulement à l'arrivée de la suivante : laisser les
    // anciens itinéraires à l'écran pendant le calcul afficherait un squelette
    // dans le panneau et d'anciens tracés sur la carte au même instant, et
    // rendrait cliquable une option qui ne répond plus à la question posée.
    setItineraries([]);
    setSortedBy(null);
    setSources([]);
    setSelectedId(null);

    void apiClient
      .planRoutes({ from, to })
      .then((response) => {
        if (requestIdRef.current !== requestId) return;

        setItineraries(response.itineraries);
        setSortedBy(response.sortedBy);
        setSources(response.sources);
        setSelectedId(response.itineraries[0]?.id ?? null);
        setStatus('ready');

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

        const kind = classifyPlanFailure(error);
        if (kind === 'no-route') {
          // « Aucun trajet » n'est pas une panne. Sans corps de réponse, on ne
          // sait pas quelles sources ont parlé : `sources` reste vide, et le
          // message se rabat sur sa formulation neutre.
          setSources([]);
          setStatus('ready');
          return;
        }

        // Le 401 « session morte » est déjà pris en charge globalement par
        // `SessionProvider` (UF-106) : le hook se contente d'en publier la
        // nature, sans exposer le statut ni le détail renvoyé par l'API (C11).
        setSources([]);
        setFailure(kind);
        setStatus('error');
      });
  }, []);

  const select = useCallback((itineraryId: string) => {
    setSelectedId(itineraryId);
  }, []);

  return { status, itineraries, sortedBy, sources, selectedId, failure, plan, select };
}
