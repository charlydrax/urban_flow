'use client';

import type { Itinerary } from '@urbanflow/shared';

/**
 * Bouton « Simuler le déplacement » (UF-701) — l'outil de démonstration, sous
 * le bouton « Démarrer » de la liste de résultats.
 *
 * ## Ce qu'il fait, et pour qui
 *
 * Il rejoue l'itinéraire retenu sur une position fictive : la carte avance, la
 * progression suit, le compteur CO₂ monte, l'arrivée se déclenche et le trajet
 * entre dans « Mon impact » (UF-807). Sans lui, rien de tout cela n'est
 * observable depuis un poste fixe — il faudrait marcher réellement de la
 * Part-Dieu à Bellecour.
 *
 * Il n'est peint **que pour un compte exploitant** : simuler un déplacement,
 * c'est le faire compter, et un usager n'a pas à se composer un bilan.
 *
 * ## Cacher le bouton n'est pas protéger la fonctionnalité
 *
 * C'est le point à ne pas confondre. La condition d'affichage ci-dessous est
 * du **confort** : elle évite de proposer une action qui serait refusée. La
 * sécurité, elle, est ailleurs — sur `POST /api/simulation/trip`, que le
 * `RolesGuard` réserve au rôle `admin` en relisant la base à chaque appel
 * (C4 / OWASP A01). Un usager qui appellerait l'endpoint directement reçoit un
 * `403`, et un usager qui forcerait l'affichage du bouton dans son navigateur
 * obtiendrait ce même `403`, affiché à l'écran.
 *
 * C'est pourquoi le composant ne décide de rien : c'est l'écran qui le monte
 * ou non, à partir du rôle de la session, et le hook qui affiche le refus.
 *
 * ## Style
 *
 * Secondaire — bordure et texte `primary`, pas de fond plein. « Démarrer la
 * navigation » reste l'action du parcours ; celle-ci est un outil, et deux
 * boutons pleins côte à côte se disputeraient un regard qui n'a qu'une
 * décision à prendre. Aucun style nouveau : ce sont les jetons déjà posés par
 * le bouton de recentrage du panneau de guidage.
 *
 * Couvre : C2 (cible tactile pleine largeur ≥ 44 px), C7 (le libellé accessible
 * nomme l'itinéraire et dit que le déplacement est simulé, l'état d'attente est
 * annoncé et pas seulement grisé).
 */
export interface SimulateNavigationProps {
  itinerary: Itinerary;
  /** `true` entre le clic et l'arrivée de la trace (UF-701). */
  preparing: boolean;
  /** Message de refus ou de panne à afficher sous le bouton, `null` sinon. */
  error: string | null;
  onSimulate: (itinerary: Itinerary) => void;
}

export function SimulateNavigation({
  itinerary,
  preparing,
  error,
  onSimulate,
}: SimulateNavigationProps) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onSimulate(itinerary)}
        disabled={preparing}
        // Le libellé accessible dit **que c'est une simulation** : « Simuler »
        // seul, entendu hors du contexte de la page, pourrait passer pour un
        // départ réel (C7 — WCAG 2.4.6).
        aria-label={`Simuler le déplacement sur l’itinéraire ${itinerary.durationMinutes} minutes, sans se déplacer réellement`}
        className="min-h-11 w-full rounded-lg border border-primary px-4 py-3 font-semibold text-primary-dark transition-colors hover:bg-tint-green disabled:opacity-60 disabled:hover:bg-transparent"
      >
        {preparing ? (
          'Préparation de la simulation…'
        ) : (
          <>
            <span aria-hidden="true">⏩ </span>
            Simuler le déplacement
          </>
        )}
      </button>

      {/*
        `role="alert"` : le refus arrive après une action de l'usager et doit
        être annoncé sans qu'il ait à repartir en exploration. Le ton est
        `error` — c'est bien un échec de l'action demandée — mais le message,
        lui, propose la sortie (« lancez un trajet réel »), il ne se contente
        pas de constater (C7).
      */}
      {error && (
        <p
          role="alert"
          className="rounded-md bg-tint-red px-3 py-2 text-xs font-semibold text-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
