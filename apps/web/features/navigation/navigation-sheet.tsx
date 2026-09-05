'use client';

import { formatCarbon } from '../../lib/format-carbon';
import { formatDistance } from '../../lib/format-distance';
import {
  estimatedArrival,
  guidanceAnnouncement,
  guidanceHeadline,
  guidanceSteps,
  guidanceSubline,
  type NavigationState,
} from '../../lib/navigation-machine';

export interface NavigationSheetProps {
  state: NavigationState;
  /** `true` quand la caméra suit la position — pilote l'état du bouton « Recentrer ». */
  following: boolean;
  onFollowAgain: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

/**
 * Panneau de guidage, d'après la maquette « 6. NAVIGATION » (« Navigation temps
 * réel · Géolocalisation · segments multimodaux »).
 *
 * ## Ce que la planche montre, et dans quel ordre
 *
 * ```
 * ┌────────────────────────────────────────────────┐
 * │ Encore 11 min à vélo                     10:03 │ ← le reste d'abord, l'ETA à droite
 * │ Puis bus C3 — passe dans 4 min                 │ ← ce qui vient après
 * │                                                │
 * │ 🚲 ✓ › (🚲 11 min) › 🚌 6 › 🚶 2               │ ← le fil des étapes
 * │                                                │
 * │ [   ▶ Reprendre le guidage   ]  [ ↗ ]          │ ← l'action, et la caméra
 * │ 🌱 84 g CO₂ émis sur 240 g CO₂                 │ ← le compteur qui monte
 * └────────────────────────────────────────────────┘
 * ```
 *
 * En mode simulation (UF-701), un bandeau ambre coiffe le panneau : l'écran
 * est volontairement identique à un guidage réel — c'est ce qui en fait une
 * démonstration honnête du parcours — donc il doit dire ce qu'il est.
 *
 * Le titre est ce qu'on lit en marchant : il porte **le reste**, pas la durée
 * totale, et il est en `font-display` comme la durée des cartes de résultats.
 * L'heure d'arrivée est en vert et à droite, à la place que lui donne la
 * planche — c'est la seconde question qu'on se pose, et la seule qui intéresse
 * qui attend à l'autre bout.
 *
 * ## Écarts assumés à la maquette
 *
 * | Élément planche         | Pourquoi il n'est pas là                          |
 * | ----------------------- | -------------------------------------------------- |
 * | « +45 pts à l'arrivée » | La gamification est hors périmètre du prototype    |
 * |                         | (CLAUDE.md §3) — même écart qu'en UF-404.          |
 * | « ✓ correspondance OK » | Le sous-titre dit l'horaire réel du prochain       |
 * |                         | passage quand la source l'horodate ; juger la      |
 * |                         | correspondance « OK » demanderait de comparer à    |
 * |                         | une heure d'arrivée que nous estimons, pas que     |
 * |                         | nous connaissons. Annoncer « OK » sur une          |
 * |                         | estimation ferait rater un bus (C9).               |
 *
 * Le bouton principal est **« Mettre en pause » en cours de guidage** et
 * « Reprendre le guidage » à l'arrêt : la planche montre l'écran suspendu, donc
 * son libellé de reprise. Peindre « Reprendre » pendant que la carte avance
 * dirait le contraire de ce que fait l'écran.
 *
 * Couvre : C2 (feuille basse, cible tactile ≥ 44 px), C6 (chaque état du
 * capteur a son message), C7 (annonce `aria-live`, statut d'étape jamais porté
 * par la seule couleur, `aria-pressed` sur la caméra).
 */
export function NavigationSheet({
  state,
  following,
  onFollowAgain,
  onPause,
  onResume,
  onStop,
}: NavigationSheetProps) {
  const steps = guidanceSteps(state);
  const arrival = estimatedArrival(state);
  const subline = guidanceSubline(state);
  const isPaused = state.phase === 'paused';
  const hasArrived = state.phase === 'arrived';
  const carbon = state.itinerary ? formatCarbon(state.itinerary.carbonGrams) : null;
  const emitted = state.itinerary ? formatCarbon(state.travelledCarbonGrams) : null;
  const isSimulated = state.source === 'simulation';

  return (
    <section
      aria-label="Guidage en cours"
      className="flex flex-col gap-3 rounded-t-2xl border-t border-ink-200 bg-white p-4 shadow-card"
    >
      {/*
        Annonce des changements d'état (C7 — WCAG 4.1.3). `polite` et non
        `assertive` : le guidage informe, il n'interrompt pas une saisie en
        cours. La phrase est complète et autonome — voir `guidanceAnnouncement`.
      */}
      <p className="sr-only" aria-live="polite">
        {guidanceAnnouncement(state)}
      </p>

      {/*
        Bandeau du mode simulation (UF-701), en tête du panneau et pas ailleurs.

        Il est là pour une raison de fond : cet écran est **indiscernable** d'un
        guidage réel — même carte, même progression, même compteur — et c'est
        exactement ce qui en fait une bonne démonstration. Le dire en toutes
        lettres est donc la contrepartie obligatoire, sans quoi une capture
        d'écran ou un regard par-dessus l'épaule ferait passer une position
        fabriquée pour une mesure.

        `role="status"` et non `alert` : ce n'est pas un incident, c'est un
        régime de fonctionnement. L'annonce vocale, elle, est déjà portée par
        `guidanceAnnouncement`, qui préfixe chaque phrase — le bandeau reste
        donc `aria-hidden` pour ne pas la doubler à chaque changement d'état.
      */}
      {isSimulated && (
        <p
          role="status"
          className="rounded-md bg-tint-gold px-3 py-2 text-xs font-semibold text-warning"
        >
          <span aria-hidden="true">⏩ </span>
          Mode simulation — le déplacement est rejoué, votre position réelle n’est pas suivie.
        </p>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl leading-tight text-ink">{guidanceHeadline(state)}</h2>
          {subline && <p className="mt-1 text-sm text-ink-500">{subline}</p>}
        </div>

        {arrival && (
          <p className="shrink-0 text-right">
            {/*
              « Arrivée » en toutes lettres : « 10:03 » seul ne dit pas de quelle
              heure il s'agit, ni à l'œil ni au lecteur d'écran (WCAG 1.3.1).
            */}
            <span className="block text-[11px] uppercase tracking-wide text-ink-500">Arrivée</span>
            <b className="font-display text-lg leading-none text-primary-dark">{arrival}</b>
          </p>
        )}
      </div>

      {/*
        Fil des étapes. `<ol>` et non une rangée de `<span>` : c'est une suite
        ordonnée, et son ordre porte du sens. Le statut de chaque étape est
        écrit dans le texte lu (« faite », « en cours ») en plus de la couleur
        et de la coche — la couleur ne porte jamais seule (C7 — WCAG 1.4.1).
      */}
      {steps.length > 0 && (
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {steps.map((step, index) => (
            <li key={step.key} className="flex items-center gap-1.5">
              {index > 0 && (
                <span aria-hidden="true" className="text-ink-200">
                  ›
                </span>
              )}
              <span
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  step.status === 'current'
                    ? 'bg-tint-green text-primary-dark'
                    : step.status === 'done'
                      ? 'text-ink-500'
                      : 'text-ink-700'
                }`}
              >
                {/*
                  La pastille de couleur reprend celle du tracé du mode sur la
                  carte : c'est ce qui relie le « 🚌 » lu ici au trait tireté
                  dessiné au-dessus. Portée par une pastille et non par le texte
                  — les couleurs de modes sont validées à 3:1 (objets
                  graphiques), pas à 4.5:1 (texte courant).
                */}
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: step.color }}
                />
                <span aria-hidden="true">{step.icon}</span>
                <span className="sr-only">
                  {step.label}
                  {step.status === 'done'
                    ? ', étape faite'
                    : step.status === 'current'
                      ? ', étape en cours'
                      : ', à venir'}
                  {' : '}
                </span>
                {step.status === 'done' ? (
                  <>
                    <span aria-hidden="true">✓</span>
                    <span className="sr-only">terminée</span>
                  </>
                ) : (
                  <span>{step.minutes} min</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/*
        Écart au tracé (C6). Un avertissement, jamais un blocage : on ne
        recalcule aucun itinéraire côté client, et le guidage continue. Le ton
        `warning` et non `error` — s'écarter de l'itinéraire n'est pas une panne.
      */}
      {state.progress?.offRoute && state.phase === 'guiding' && (
        <p
          role="status"
          className="rounded-md bg-tint-gold px-3 py-2 text-xs font-semibold text-warning"
        >
          Vous semblez à {formatDistance(state.progress.offRouteMeters)} de l’itinéraire. Le guidage
          continue&nbsp;: rejoignez le tracé, ou relancez une recherche depuis votre position.
        </p>
      )}

      <div className="flex items-center gap-2">
        {hasArrived ? (
          <button
            type="button"
            onClick={onStop}
            className="min-h-11 flex-1 rounded-lg bg-primary px-4 font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            Terminer
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={isPaused ? onResume : onPause}
              className="min-h-11 flex-1 rounded-lg bg-primary px-4 font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              <span aria-hidden="true">{isPaused ? '▶ ' : '⏸ '}</span>
              {isPaused ? 'Reprendre le guidage' : 'Mettre en pause'}
            </button>

            {/*
              Recentrage de la caméra (« ↗ » sur la planche). `aria-pressed` :
              c'est un interrupteur à deux positions, pas une action ponctuelle —
              un lecteur d'écran doit pouvoir dire si le suivi est actif
              (WCAG 4.1.2). Désactivé quand il l'est déjà : le presser ne ferait
              rien, et un bouton qui ne fait rien est un bouton qui ment.
            */}
            <button
              type="button"
              onClick={onFollowAgain}
              aria-pressed={following}
              disabled={following}
              className="grid size-11 shrink-0 place-items-center rounded-lg border border-primary text-primary-dark transition-colors hover:bg-tint-green disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <span aria-hidden="true">↗</span>
              <span className="sr-only">
                {following ? 'La carte suit votre position' : 'Recentrer la carte sur ma position'}
              </span>
            </button>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs">
        {/*
          L'empreinte de l'option suivie, seul chiffre de la ligne de bas de
          panneau que la planche nous permette de tenir (voir « Écarts assumés »).
        */}
        {carbon && emitted ? (
          /*
            Le compteur monte au fil du trajet (UF-701) — « 84 g CO₂ émis
            sur 240 g ».

            L'empreinte totale est déjà connue depuis la planification : elle
            répond à « combien coûte ce trajet ? », question réglée avant le
            départ. Le premier chiffre répond à celle qu'on se pose en route,
            « combien ai-je déjà émis ? », et c'est lui qui rend perceptible ce
            que le produit veut faire voir : l'empreinte ne monte pas au même
            rythme selon le mode — presque pas pendant les vingt minutes de
            vélo, d'un coup pendant les six de bus.

            Les deux chiffres sont dans le même `aria-live` que le reste du
            panneau ? Non : ils changent à chaque mesure, et les annoncer
            noierait les changements d'étape sous un flot de grammes (C7). Le
            texte reste lisible à la demande, il n'est pas crié.
          */
          <span className="font-bold text-primary-dark">
            <span aria-hidden="true">🌱 </span>
            {emitted} émis sur {carbon}
          </span>
        ) : (
          <span />
        )}

        {!hasArrived && (
          <button
            type="button"
            onClick={onStop}
            className="min-h-11 px-1 font-semibold text-ink-500 underline underline-offset-2 hover:text-ink"
          >
            Arrêter la navigation
          </button>
        )}
      </div>
    </section>
  );
}
