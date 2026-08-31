'use client';

import { CARBON_SUMMARY_DAYS, type CarbonSummaryDays } from '@urbanflow/shared';

import { carEquivalentKm, changeSummary } from '../../lib/carbon-summary';
import { formatCarbon } from '../../lib/format-carbon';
import { CarbonGoalCard } from './carbon-goal-card';
import { ImpactComparison } from './impact-comparison';
import { ImpactTrend } from './impact-trend';
import { ModeBreakdown } from './mode-breakdown';
import { TripTable } from './trip-table';
import { useCarbonSummary } from './use-carbon-summary';

/** Libellé du sélecteur de période — « 7 jours », « 30 jours »… */
const periodLabel = (days: CarbonSummaryDays): string => `${days} jours`;

/**
 * Page « Mon impact » (UF-505, complétée par UF-805) — le suivi carbone
 * personnel, d'après la maquette Figma « 8. EMPREINTE CARBONE » (mobile) et
 * « DESKTOP 3 : EMPREINTE CARBONE » (large).
 *
 * ```
 * Mon impact                              [7j] [30j] [90j]
 * ┌──────────────────────────────────────────────────────┐
 * │  CO₂ évité      42,8 kg                              │  ← bandeau vert
 * │  ≈ 285 km de voiture évités                          │
 * └──────────────────────────────────────────────────────┘
 * [CO₂ émis 13,5 kg] [Évolution −20 %] [Trajets 12]
 * ┌── Vos trajets vs tout en voiture ──┐ ┌── Évolution ──────┐
 * ┌── Émissions par mode ─────────────┐ ┌── 🎯 Objectif ────┐
 * ┌── Détail par trajet ─────────────────────[📤 Exporter]──┐
 * ```
 *
 * ## Ce que UF-805 a ajouté, et pourquoi ce n'était pas là avant
 *
 * UF-505 s'était arrêté à deux visualisations et l'assumait : la répartition
 * par mode « supposerait de stocker le détail par segment de chaque trajet
 * retenu, donc une table de plus — c'est un ticket, pas une case à cocher ».
 * C'était ce ticket-ci. La table existe (`trip_mode_footprints`), et avec elle
 * les trois blocs manquants de la planche : la **répartition par mode**,
 * l'**objectif** carbone et le **détail par trajet** avec son export.
 *
 * Aucun d'eux ne calcule quoi que ce soit : l'API publie des totaux déjà
 * agrégés par la base, et les composants n'en tirent que des largeurs de barre
 * (C5).
 *
 * ## Ce qui est compté, et ce qui est dit
 *
 * Seuls les trajets pour lesquels un itinéraire a été **retenu** entrent dans
 * les totaux. Les recherches restées sans choix sont annoncées en bas de page :
 * sans cette phrase, quelqu'un qui cherche beaucoup et choisit peu verrait un
 * total bas sans pouvoir comprendre pourquoi, et conclurait à une panne.
 *
 * ⚠️ « Retenu » n'est pas encore « réalisé ». Distinguer l'itinéraire
 * sélectionné du trajet effectivement parcouru est l'objet d'UF-807, qui
 * s'appuiera sur l'arrivée effective du mode navigation (UF-806) — aucun des
 * deux n'existe à ce jour. Tout ce qui est ajouté ici lit `search_history` par
 * l'API et **rien d'autre** : le jour où le filtre « réalisé » y sera posé, ces
 * blocs suivront sans être retouchés.
 *
 * ## Un compte neuf n'est pas une erreur
 *
 * Un bilan vide affiche des zéros **et** la marche à suivre pour le remplir,
 * jamais un message d'échec. À l'inverse, une lecture qui échoue le dit : « 0 g
 * CO₂ » affiché à la place d'une réponse manquante serait un faux bilan, ce qui
 * est pire qu'un message d'erreur. Même règle pour l'objectif : ne pas en avoir
 * fixé n'est pas en avoir un à zéro, et l'écran propose alors d'en définir un.
 *
 * Couvre : C2 (indicateurs empilés sur mobile, en grille à partir de `sm`, le
 * tableau par trajet défilant dans son propre conteneur), C5 (une lecture par
 * période, les trajets seulement à la demande, aucun rafraîchissement
 * automatique), C7 (le sélecteur est un groupe de boutons radio, chaque
 * proportion visuelle est doublée d'un texte, le détail est un vrai tableau),
 * C8 (les données affichées — et exportées — sont celles du seul compte
 * connecté).
 */
export function CarbonDashboard() {
  const { status, summary, days, setDays, reload } = useCarbonSummary();

  return (
    <div className="flex flex-col gap-4">
      {/*
        Groupe de boutons radio et non une liste de boutons : choisir une période,
        c'est en désigner UNE parmi trois. Le motif l'annonce aux technologies
        d'assistance et apporte la navigation aux flèches (C7 — WCAG 4.1.2) —
        même parti pris que le sélecteur de tri du planificateur.
      */}
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">Période du suivi</legend>
        {CARBON_SUMMARY_DAYS.map((option) => (
          <label
            key={option}
            className={`min-h-11 cursor-pointer rounded-full border-2 px-4 py-2 text-sm font-bold ${
              option === days
                ? 'border-primary bg-primary text-white'
                : 'border-ink-200 text-ink-700 hover:bg-surface-muted'
            }`}
          >
            <input
              type="radio"
              name="carbon-period"
              className="sr-only"
              checked={option === days}
              onChange={() => setDays(option)}
            />
            {periodLabel(option)}
          </label>
        ))}
      </fieldset>

      {status === 'error' && (
        <p role="alert" className="rounded-lg bg-tint-red px-4 py-3 text-sm text-error">
          Votre bilan n’a pas pu être chargé. Vérifiez votre connexion, puis réessayez.
        </p>
      )}

      {status === 'loading' && !summary && (
        // Squelette plutôt que des zéros : afficher un bilan nul pendant le
        // chargement le ferait lire comme un résultat.
        <p aria-live="polite" className="text-sm text-ink-500">
          Chargement de votre bilan…
        </p>
      )}

      {status === 'ready' && summary && (
        <>
          {/*
            Bandeau vert : l'indicateur principal de la maquette. Le CO₂ évité, et
            non le CO₂ émis — c'est le résultat des choix de l'usager, et la seule
            grandeur qu'il a intérêt à faire monter.
          */}
          <section
            aria-labelledby="impact-hero-title"
            className="rounded-lg bg-primary-dark p-5 text-white"
          >
            <h2 id="impact-hero-title" className="text-sm font-bold">
              CO₂ évité sur {periodLabel(days)}
            </h2>
            <p className="font-display text-4xl font-extrabold">
              {formatCarbon(summary.current.avoidedGrams)}
            </p>
            <p className="mt-2 text-sm">
              ≈ {carEquivalentKm(summary.current.carEquivalentGrams).toLocaleString('fr-FR')}
              &nbsp;km de voiture évités
            </p>
          </section>

          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-ink-200 bg-white p-4 shadow-card">
              <dt className="text-sm text-ink-700">CO₂ émis</dt>
              <dd className="text-2xl font-bold text-ink">
                {formatCarbon(summary.current.emittedGrams)}
              </dd>
            </div>

            <div className="rounded-lg border border-ink-200 bg-white p-4 shadow-card">
              <dt className="text-sm text-ink-700">Évolution</dt>
              {/*
                La couleur suit la DIRECTION, pas le signe : une variation
                d'émissions négative est une bonne nouvelle, et un « −20 % » peint
                en rouge dirait l'inverse de ce que la page veut dire.
              */}
              <dd
                className={`text-sm font-bold ${
                  changeSummary(summary.emittedChangePercent).direction === 'down'
                    ? 'text-primary-dark'
                    : changeSummary(summary.emittedChangePercent).direction === 'up'
                      ? 'text-error'
                      : 'text-ink-500'
                }`}
              >
                {changeSummary(summary.emittedChangePercent).label}
              </dd>
            </div>

            <div className="rounded-lg border border-ink-200 bg-white p-4 shadow-card">
              <dt className="text-sm text-ink-700">Trajets retenus</dt>
              <dd className="text-2xl font-bold text-ink">{summary.current.tripsCount}</dd>
            </div>
          </dl>

          <div className="grid gap-4 lg:grid-cols-2">
            <ImpactComparison totals={summary.current} />
            <ImpactTrend buckets={summary.buckets} />
          </div>

          {/*
            Les trois blocs ajoutés par UF-805, dans l'ordre de la planche :
            répartition par mode, objectif, puis détail par trajet. Sur mobile
            ils s'empilent ; à partir de `lg`, la répartition et l'objectif se
            partagent la largeur comme sur la maquette desktop (C2).
          */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ModeBreakdown
              modeBreakdown={summary.modeBreakdown}
              emittedGrams={summary.current.emittedGrams}
            />
            <CarbonGoalCard goal={summary.goal} days={days} onSaved={reload} />
          </div>

          <TripTable days={days} />

          {summary.current.tripsCount === 0 && (
            <p className="rounded-lg bg-tint-green px-4 py-3 text-sm text-primary-dark">
              Votre bilan est encore vide. Lancez une recherche d’itinéraire, puis{' '}
              <b>choisissez une option</b> dans la liste des résultats&nbsp;: c’est ce choix qui est
              compté ici.
            </p>
          )}

          {summary.unpricedTripsCount > 0 && (
            /*
              Honnêteté du chiffre : ces recherches existent bien dans
              l'historique mais ne pèsent rien dans les totaux. Sans cette
              phrase, l'écart entre « j'ai beaucoup cherché » et « mon bilan est
              bas » passerait pour un défaut de l'application.
            */
            <p className="text-xs text-ink-500">
              {summary.unpricedTripsCount} recherche
              {summary.unpricedTripsCount > 1 ? 's' : ''} de cette période{' '}
              {summary.unpricedTripsCount > 1 ? 'ne sont' : "n'est"} pas comptée
              {summary.unpricedTripsCount > 1 ? 's' : ''}&nbsp;: aucun itinéraire n’y a été retenu.
            </p>
          )}

          <p className="text-xs text-ink-500">
            Calcul basé sur les ordres de grandeur de la Base Empreinte de l’ADEME (g&nbsp;CO₂e par
            passager et par kilomètre). La référence «&nbsp;tout en voiture&nbsp;» correspond à la
            même distance parcourue seul à bord.
          </p>
        </>
      )}
    </div>
  );
}
