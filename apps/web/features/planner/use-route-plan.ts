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
  /** Message d'erreur prêt à afficher, ou `null`. */
  error: string | null;
  /** Lance une recherche ; annule silencieusement celle qui serait encore en vol. */
  plan: (from: Place, to: Place) => void;
  /** Change l'itinéraire mis en avant (recette 4 du ticket). */
  select: (itineraryId: string) => void;
}

/** Message affiché quand l'appel échoue — générique côté client, le détail reste dans les logs (C11). */
const PLAN_FAILED =
  'Le calcul d’itinéraires n’a pas abouti. Vérifiez votre connexion, puis relancez la recherche.';

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
  const [error, setError] = useState<string | null>(null);

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
    setError(null);

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
      .catch(() => {
        if (requestIdRef.current !== requestId) return;

        // Le 401 « session morte » est déjà pris en charge globalement par
        // `SessionProvider` (UF-106) : ici on se contente d'un message unique,
        // sans exposer le statut ni le détail renvoyé par l'API (C11).
        setItineraries([]);
        setSelectedId(null);
        setError(PLAN_FAILED);
        setStatus('error');
      });
  }, []);

  const select = useCallback((itineraryId: string) => {
    setSelectedId(itineraryId);
  }, []);

  return { status, itineraries, sortedBy, sources, selectedId, error, plan, select };
}
