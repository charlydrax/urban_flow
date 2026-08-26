'use client';

import { useEffect, useState, type FormEvent } from 'react';

import type { Place, SearchHistoryEntry, SearchHistoryPlace } from '@urbanflow/shared';

import { Button } from '../../components/ui/button';
import { useSession } from '../auth/session-provider';
import { reverseGeocode, type GeocodedPlace } from '../../lib/geocoding';
import { formatPositionLabel } from '../../lib/geolocation';
import { EMPTY_TRIP_POINT, type TripPoint } from './address-autocomplete';
import { LocateMe } from './locate-me';
import { RecentSearches } from './recent-searches';
import { TripFields } from './trip-fields';
import { useSearchHistory } from './use-search-history';
import type { UserLocationState } from './use-user-location';

/** Rappelé à la soumission tant que les deux extrémités ne sont pas géocodées. */
const MISSING_COORDINATES =
  'Choisissez une suggestion pour le départ et pour l’arrivée : le calcul d’itinéraire a besoin de coordonnées, pas seulement d’un texte.';

/**
 * Ramène une adresse géocodée au contrat partagé `Place` (`packages/shared`).
 * Les champs internes (`id`, `context`) ne franchissent pas la frontière API :
 * ce sont des détails d'affichage, pas des données du domaine (C9).
 */
function toPlace({ label, lat, lng }: GeocodedPlace): Place {
  return { label, lat, lng };
}

/**
 * Même projection pour l'historique (UF-204), où les coordonnées sont
 * **obligatoires** : une ligne stockée en géométrie PostGIS ne peut pas être
 * amputée d'un de ses points. Le type distinct rend cette exigence visible dès
 * la compilation, plutôt qu'au 400 renvoyé par l'API.
 */
function toHistoryPlace({ label, lat, lng }: GeocodedPlace): SearchHistoryPlace {
  return { label, lat, lng };
}

/**
 * Reconstruit un point de saisie à partir d'une entrée d'historique (UF-204).
 *
 * Le point revient **déjà résolu** (`place` non nul) : rejouer un trajet récent
 * ne redemande donc rien au géocodeur, alors qu'un simple remplissage textuel
 * aurait obligé l'utilisateur à re-sélectionner une suggestion (C5, C10).
 *
 * `context` est vide et `id` synthétique : l'historique conserve le libellé et
 * les coordonnées — le strict nécessaire pour relancer une recherche —, pas la
 * fiche d'adresse complète de la BAN (minimisation, C8).
 */
function toTripPoint(place: SearchHistoryPlace, id: string): TripPoint {
  return { text: place.label, place: { id, context: '', ...place } };
}

/**
 * Formulaire de recherche d'itinéraire (F2).
 *
 * UF-202 y a branché la géolocalisation consentie ; **UF-203 y branche le
 * géocodage** : les deux extrémités du trajet ne sont plus du texte libre mais
 * des adresses résolues en coordonnées, prêtes à devenir le `{ from, to }` de
 * `POST /api/routes/plan` (étape 1 du flux de référence).
 *
 * ## Deux niveaux de saisie, assumés
 *
 * Le champ reste un champ de texte ordinaire : on peut y taper n'importe quoi.
 * Mais seule la **sélection d'une suggestion** produit un `lat/lng`, et c'est
 * cela que la soumission exige. Ce compromis évite deux écueils opposés — un
 * champ verrouillé qui refuse la frappe libre, et un formulaire qui accepterait
 * « chez moi » puis échouerait côté serveur.
 *
 * ## Géolocalisation et géocodage inverse
 *
 * Une position obtenue via « Me localiser » remplit le départ **immédiatement**
 * avec ses coordonnées, puis ce libellé est remplacé par l'adresse réelle dès
 * que le géocodage inverse répond — comme sur la maquette (« Départ · position
 * actuelle → 14 rue de la République, Lyon 2e »). L'utilisateur n'attend jamais
 * le réseau (C10), et une panne du géocodeur laisse simplement les coordonnées.
 *
 * ## Historique (UF-204)
 *
 * Chaque soumission valide est **enregistrée** pour le compte connecté, et les
 * derniers trajets reviennent sous les champs en rappels recliquables. L'écriture
 * part en arrière-plan : un historique indisponible ne doit jamais empêcher une
 * recherche d'aboutir (C10). Sans session vivante, rien n'est ni lu ni écrit —
 * il n'y a pas d'historique anonyme (C8).
 *
 * Accessibilité (C7) : libellés explicites, aide reliée par `aria-describedby`,
 * erreur de soumission en `role="alert"`, retours de géolocalisation annoncés
 * par `LocateMe`, autocomplétion au motif ARIA « combobox ».
 */
export function PlannerForm({ location }: { location: UserLocationState }) {
  const [from, setFrom] = useState<TripPoint>(EMPTY_TRIP_POINT);
  const [to, setTo] = useState<TripPoint>(EMPTY_TRIP_POINT);
  const [formError, setFormError] = useState<string | null>(null);
  /** Dernier trajet validé — les deux `Place` qui partiront vers l'API. */
  const [trip, setTrip] = useState<{ from: Place; to: Place } | null>(null);

  const { status: sessionStatus } = useSession();
  const history = useSearchHistory(sessionStatus === 'authenticated');

  const { position } = location;

  useEffect(() => {
    if (!position) {
      // Position effacée (C8) : on retire le libellé que **nous** avions posé,
      // et seulement lui — une adresse choisie entre-temps doit survivre.
      setFrom((current) => (current.autofilled ? EMPTY_TRIP_POINT : current));
      return;
    }

    const controller = new AbortController();

    // Libellé de repli affiché sans attendre le réseau : des coordonnées valent
    // toujours mieux qu'un champ vide pendant une seconde.
    const fallback: GeocodedPlace = {
      id: `user-position:${position.lat},${position.lng}`,
      label: formatPositionLabel(position),
      context: '',
      lat: position.lat,
      lng: position.lng,
    };
    setFrom((current) =>
      current.text === '' || current.autofilled
        ? { text: fallback.label, place: fallback, autofilled: true }
        : current,
    );

    void reverseGeocode(position.lat, position.lng, controller.signal).then((address) => {
      if (!address || controller.signal.aborted) return;
      // On n'écrase que notre propre libellé : si l'utilisateur a repris la main
      // entre-temps, l'adresse trouvée est simplement abandonnée.
      setFrom((current) =>
        current.autofilled ? { text: address.label, place: address, autofilled: true } : current,
      );
    });

    return () => controller.abort();
  }, [position]);

  /** Toute modification du trajet périme le message de la soumission précédente. */
  const resetOutcome = () => {
    setFormError(null);
    setTrip(null);
  };

  /**
   * Inversion départ/arrivée (recette 3 du ticket).
   * Le drapeau `autofilled` ne suit pas : après une inversion explicite, les
   * deux champs appartiennent à l'utilisateur, plus à la géolocalisation.
   */
  const handleSwap = () => {
    setFrom({ ...to, autofilled: false });
    setTo({ ...from, autofilled: false });
    resetOutcome();
  };

  /**
   * Rejoue un trajet récent (UF-204) : les deux champs repartent résolus, prêts
   * à être soumis. On ne soumet pas à la place de l'utilisateur — il veut
   * souvent ajuster une extrémité avant de relancer.
   */
  const handleRecentSelect = (entry: SearchHistoryEntry) => {
    setFrom(toTripPoint(entry.from, `${entry.id}-from`));
    setTo(toTripPoint(entry.to, `${entry.id}-to`));
    resetOutcome();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!from.place || !to.place) {
      setFormError(MISSING_COORDINATES);
      return;
    }
    setFormError(null);

    // Étape 18 du flux : la recherche est mémorisée dès sa soumission, donc
    // avant tout choix d'itinéraire (`selectedSummary` et le CO₂ suivront quand
    // le calcul existera). Appel non attendu : voir `useSearchHistory`.
    history.remember(toHistoryPlace(from.place), toHistoryPlace(to.place));

    // Le contrat de `POST /api/routes/plan` est déjà tenu ici : deux `Place`
    // complets, coordonnées comprises. Le ticket UF-203 s'arrête à leur
    // constitution ; le rendu des résultats arrive avec UF-404.
    // TODO(UF-404) : apiClient.planRoutes({ from, to }) + rendu des résultats.
    // ⚠️ En le branchant, SUPPRIMER le `history.remember` ci-dessus : depuis
    // UF-402 l'API enregistre elle-même la recherche et renvoie la ligne créée
    // dans `searchHistoryId` — garder les deux créerait un doublon.
    setTrip({ from: toPlace(from.place), to: toPlace(to.place) });
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-describedby="planner-help"
      className="flex flex-col gap-4 rounded-lg border border-primary/20 bg-white p-4"
    >
      <p id="planner-help" className="text-sm">
        Saisissez un départ et une arrivée, puis choisissez une adresse dans la liste proposée.
      </p>

      <LocateMe location={location} />

      <TripFields
        from={from}
        to={to}
        onFromChange={(next) => {
          setFrom(next);
          resetOutcome();
        }}
        onToChange={(next) => {
          setTo(next);
          resetOutcome();
        }}
        onSwap={handleSwap}
        fromHint={from.autofilled ? 'position actuelle' : undefined}
      />

      {/* Les rappels sont posés juste sous les champs qu'ils remplissent : c'est
          ce voisinage qui rend le raccourci lisible (maquette « PLANIFICATEUR F2 »). */}
      <RecentSearches entries={history.entries} onSelect={handleRecentSelect} />

      {formError && (
        <p role="alert" className="text-xs font-semibold text-error">
          {formError}
        </p>
      )}

      {trip && (
        <p role="status" className="rounded-md bg-tint-green px-3 py-2 text-xs text-ink-700">
          Trajet prêt&nbsp;: <strong>{trip.from.label}</strong> → <strong>{trip.to.label}</strong>.
          Le calcul des itinéraires et de leur empreinte carbone arrive dans le ticket suivant.
        </p>
      )}

      <Button type="submit" size="lg" className="w-full">
        Comparer les itinéraires
      </Button>
    </form>
  );
}
