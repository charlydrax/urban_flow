'use client';

import {
  CARBON_GOAL_MAX_GRAMS,
  CARBON_GOAL_MIN_GRAMS,
  type CarbonGoal,
  type CarbonSummaryDays,
} from '@urbanflow/shared';
import { useState } from 'react';

import { apiClient } from '../../lib/api-client';
import { describeCarbonGoal } from '../../lib/carbon-goal';

interface CarbonGoalCardProps {
  /** Objectif proraté publié par l'API, `null` si l'usager n'en a pas fixé. */
  goal: CarbonGoal | null;
  /** Période affichée — nomme la fenêtre dans la phrase de l'objectif. */
  days: CarbonSummaryDays;
  /** Rejoue la lecture du bilan une fois l'objectif enregistré. */
  onSaved: () => void;
}

/** Grammes → kilogrammes pour le champ de saisie : personne ne pense en grammes. */
const toKilograms = (grams: number): number => Math.round(grams / 100) / 10;

/**
 * Objectif carbone de la page « Mon impact » (UF-805) — le bloc « 🎯 Objectif :
 * rester sous 16 kg » de la planche, et le bouton « Définir un objectif » de sa
 * version desktop.
 *
 * ```
 * ┌───────────────────────────────────────────────┐
 * │ 🎯 Objectif : rester sous 16 kg        84 %   │
 * │ ████████████████████░░░░                      │
 * │ 13,5 kg / 16 kg — en bonne voie               │
 * └───────────────────────────────────────────────┘
 * ```
 *
 * ## Saisie en kilogrammes, stockage en grammes
 *
 * Le domaine carbone compte en grammes de bout en bout — c'est l'unité de la
 * base, de l'API et du barème. Mais personne ne se fixe « 16 000 g » comme
 * objectif mensuel : le champ parle en kilogrammes et la conversion se fait
 * ici, au bord. Une unité pour les humains, une pour les machines, et un seul
 * endroit qui passe de l'une à l'autre.
 *
 * ## Le formulaire est replié par défaut
 *
 * Un objectif se fixe une fois puis se regarde tous les jours. L'afficher
 * déplié en permanence mettrait un champ de saisie au milieu d'un tableau de
 * bord de consultation, et pousserait le tableau par trajet sous la ligne de
 * flottaison sur mobile (C2).
 *
 * Couvre : C2 (bloc pleine largeur sur mobile), C4 (les bornes du serveur sont
 * reprises sur le champ, sans jamais s'y substituer), C7 (le formulaire est un
 * vrai `form` avec un `label` lié, l'état est annoncé par un mot autant que par
 * une couleur).
 */
export function CarbonGoalCard({ goal, days, onSaved }: CarbonGoalCardProps) {
  const view = describeCarbonGoal(goal, days);

  const [editing, setEditing] = useState(false);
  const [kilograms, setKilograms] = useState(() =>
    goal ? String(toKilograms(goal.monthlyGrams)) : '',
  );
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');

  const save = async (monthlyCarbonGoalGrams: number | null): Promise<void> => {
    setStatus('saving');
    try {
      await apiClient.updateProfile({ preferences: { monthlyCarbonGoalGrams } });
      setStatus('idle');
      setEditing(false);
      // Le bilan est rechargé plutôt que corrigé sur place : c'est le serveur
      // qui proratise l'objectif à la période affichée, et refaire ce calcul
      // ici ferait diverger les deux le jour où la règle changerait.
      onSaved();
    } catch {
      setStatus('error');
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const grams = Math.round(Number(kilograms.replace(',', '.')) * 1000);
    if (!Number.isFinite(grams)) {
      setStatus('error');
      return;
    }
    void save(grams);
  };

  const tone =
    view?.state === 'exceeded'
      ? 'border-error/40 bg-tint-red'
      : view?.state === 'close'
        ? 'border-warning/40 bg-tint-gold'
        : 'border-primary/30 bg-tint-green';

  return (
    <section
      aria-labelledby="impact-goal-title"
      className={`rounded-lg border p-4 ${view ? tone : 'border-ink-200 bg-white shadow-card'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id="impact-goal-title" className="text-sm font-bold text-ink">
          <span aria-hidden="true">🎯</span>{' '}
          {view ? `Objectif : rester sous ${view.targetLabel}` : 'Objectif carbone'}
        </h3>

        {view && (
          <p
            className={`text-sm font-bold tabular-nums ${
              view.state === 'exceeded' ? 'text-error' : 'text-primary-dark'
            }`}
          >
            {view.usedPercent}&nbsp;%
          </p>
        )}
      </div>

      {view ? (
        <>
          {/*
            Barre décorative : la phrase qui la suit porte exactement la même
            information, chiffrée (C7 — WCAG 1.1.1). Sa largeur est bornée à
            100 % là où le pourcentage affiché, lui, ne l'est pas.
          */}
          <div
            aria-hidden="true"
            className="mt-2 h-2 overflow-hidden rounded-full bg-white/70 ring-1 ring-inset ring-ink-200"
          >
            <div
              className={`h-full rounded-full ${
                view.state === 'exceeded' ? 'bg-error' : 'bg-primary'
              }`}
              style={{ width: `${view.barPercent}%` }}
            />
          </div>

          <p className="mt-2 text-sm text-ink-700">{view.description}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-ink-700">
          Fixez-vous un budget mensuel : le bilan vous dira où vous en êtes, sans jamais rien
          empêcher.
        </p>
      )}

      {editing ? (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="carbon-goal-input" className="text-xs font-bold text-ink-700">
              Budget mensuel, en kilogrammes de CO₂
            </label>
            <input
              id="carbon-goal-input"
              name="carbon-goal"
              type="number"
              inputMode="decimal"
              step="0.5"
              // Les bornes du serveur, reprises telles quelles : elles guident
              // la saisie sans jamais remplacer la validation d'API (C4).
              min={CARBON_GOAL_MIN_GRAMS / 1000}
              max={CARBON_GOAL_MAX_GRAMS / 1000}
              required
              value={kilograms}
              onChange={(event) => setKilograms(event.target.value)}
              className="min-h-11 w-32 rounded-md border border-ink-200 bg-white px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={status === 'saving'}
            className="min-h-11 rounded-full bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {status === 'saving' ? 'Enregistrement…' : 'Enregistrer'}
          </button>

          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setStatus('idle');
            }}
            className="min-h-11 rounded-full border-2 border-ink-200 px-4 py-2 text-sm font-bold text-ink-700"
          >
            Annuler
          </button>

          {goal && (
            <button
              type="button"
              onClick={() => void save(null)}
              className="min-h-11 px-2 py-2 text-sm font-bold text-ink-500 underline"
            >
              Retirer l’objectif
            </button>
          )}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 min-h-11 rounded-full border-2 border-primary-dark px-4 py-2 text-sm font-bold text-primary-dark"
        >
          {goal ? 'Modifier l’objectif' : 'Définir un objectif'}
        </button>
      )}

      {status === 'error' && (
        <p role="alert" className="mt-2 text-sm text-error">
          Votre objectif n’a pas pu être enregistré. Vérifiez votre connexion, puis réessayez.
        </p>
      )}
    </section>
  );
}
