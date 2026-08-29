'use client';

import { RoutePriority } from '@urbanflow/shared';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { ApiError, apiClient } from '../../lib/api-client';
import {
  buildProfilePatch,
  MAX_WALK_MAX,
  MAX_WALK_MIN,
  MODE_OPTIONS,
  PRIORITY_LABELS,
  ProfileDraft,
  toDraft,
  toggleMode,
  validateDraft,
} from './preferences';

/** Descriptions des priorités, reprises de la maquette « 3. PROFIL F1 ». */
const PRIORITY_HINTS: Record<RoutePriority, string> = {
  [RoutePriority.GREENEST]: 'Trajets verts en priorité, empreinte carbone la plus faible.',
  [RoutePriority.FASTEST]: 'Durée de trajet la plus courte, quel que soit le mode.',
};

/**
 * Formulaire des préférences de mobilité (F1, UF-107) — câblé sur
 * `GET/PATCH /api/users/me`, d'après la maquette Figma « 3. PROFIL F1 ».
 *
 * Chargement **côté client** : la page reste un Server Component léger, et un
 * 401 en cours de route (session expirée) est capté par l'intercepteur du
 * client API, qui purge la session et renvoie vers `/login` (UF-106).
 *
 * Enregistrement **différentiel** : seuls les champs modifiés partent dans le
 * `PATCH`, et un formulaire inchangé n'envoie rien du tout (C5, C10).
 *
 * Accessibilité (C7) : groupes de champs en `fieldset`/`legend`, priorité en
 * groupe de boutons radio, descriptions reliées par `aria-describedby`, erreurs
 * annoncées en `role="alert"` et confirmation en `role="status"`, zones tactiles
 * ≥ 44 px, aucun réglage piloté par la seule couleur.
 *
 * RGPD (C8) : le consentement à la géolocalisation se donne et se retire ici,
 * d'un seul geste symétrique ; la préférence PMR (C12) est annoncée comme
 * facultative et utilisée uniquement pour le calcul d'itinéraires.
 */
export function MobilityProfileForm() {
  const [initial, setInitial] = useState<ProfileDraft | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const profile = await apiClient.getProfile();
      setInitial(toDraft(profile));
      setDraft(toDraft(profile));
    } catch (error) {
      // Un 401 est déjà traité par l'intercepteur global (purge + /login) :
      // inutile d'afficher un message qui disparaîtra avec la redirection.
      if (error instanceof ApiError && error.status === 401) return;
      setLoadError('Impossible de charger vos préférences pour le moment.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Applique une modification au brouillon et efface la confirmation précédente. */
  const edit = (change: (current: ProfileDraft) => ProfileDraft) => {
    setNotice(null);
    setDraft((current) => (current ? change(current) : current));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!initial || !draft) return;

    setNotice(null);
    const problem = validateDraft(draft);
    setFormError(problem);
    if (problem) return;

    const patch = buildProfilePatch(initial, draft);
    if (!patch) {
      setNotice('Aucune modification à enregistrer.');
      return;
    }

    setSaving(true);
    try {
      // L'API renvoie le profil relu en base : on réaligne l'état sur elle
      // plutôt que sur ce qu'on croyait avoir envoyé.
      const saved = await apiClient.updateProfile(patch);
      setInitial(toDraft(saved));
      setDraft(toDraft(saved));
      setNotice('Vos préférences ont été enregistrées.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      setFormError(
        error instanceof ApiError && error.status === 400
          ? 'Certaines valeurs ont été refusées. Vérifiez vos réglages et réessayez.'
          : 'Enregistrement impossible pour le moment. Veuillez réessayer.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <Card>
        <p role="alert" className="text-sm font-semibold text-error">
          {loadError}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          Réessayer
        </Button>
      </Card>
    );
  }

  if (!draft) {
    return (
      <Card>
        {/* `status` + `aria-busy` : le chargement est annoncé sans voler le focus (C7). */}
        <p role="status" aria-busy="true" className="text-sm text-ink-700">
          Chargement de vos préférences…
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {formError && (
        <p
          role="alert"
          className="rounded-md border-2 border-error bg-tint-red px-4 py-3 text-sm font-semibold text-error"
        >
          {formError}
        </p>
      )}

      <Card>
        <fieldset>
          <legend className="mb-1">
            <CardTitle as="h2">Mes modes préférés</CardTitle>
          </legend>
          <p id="modes-hint" className="mb-3 text-sm text-ink-700">
            Seuls les modes cochés seront proposés dans vos itinéraires.
          </p>
          <div className="flex flex-wrap gap-2" aria-describedby="modes-hint">
            {MODE_OPTIONS.map((mode) => {
              const checked = draft.preferences.preferredModes.includes(mode.value);
              return (
                <label
                  key={mode.value}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold ${
                    checked
                      ? 'border-primary bg-tint-green text-primary-dark'
                      : 'border-ink-200 bg-white text-ink-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    name="preferredModes"
                    value={mode.value}
                    checked={checked}
                    onChange={() =>
                      edit((current) => ({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          preferredModes: toggleMode(
                            current.preferences.preferredModes,
                            mode.value,
                          ),
                        },
                      }))
                    }
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span aria-hidden="true">{mode.icon}</span>
                  {mode.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>

      <Card>
        <fieldset>
          <legend className="mb-1">
            <CardTitle as="h2">Priorité de mes itinéraires</CardTitle>
          </legend>
          <p className="mb-3 text-sm text-ink-700">
            Détermine l’ordre dans lequel les options vous sont proposées.
          </p>
          <div className="flex flex-col gap-2">
            {Object.values(RoutePriority).map((priority) => {
              const hintId = `priority-${priority}-hint`;
              return (
                <label
                  key={priority}
                  className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border-2 px-4 py-3 ${
                    draft.preferences.priority === priority
                      ? 'border-primary bg-tint-green'
                      : 'border-ink-200 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="priority"
                    value={priority}
                    checked={draft.preferences.priority === priority}
                    aria-describedby={hintId}
                    onChange={() =>
                      edit((current) => ({
                        ...current,
                        preferences: { ...current.preferences, priority },
                      }))
                    }
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-bold text-ink">
                      {PRIORITY_LABELS[priority]}
                    </span>
                    <span id={hintId} className="block text-xs text-ink-700">
                      {PRIORITY_HINTS[priority]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>

      <Card>
        <CardTitle as="h2" className="mb-3">
          Accessibilité et confidentialité
        </CardTitle>

        <div className="flex flex-col gap-3">
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="reducedMobility"
              checked={draft.preferences.reducedMobility}
              aria-describedby="pmr-hint"
              onChange={(event) =>
                edit((current) => ({
                  ...current,
                  preferences: {
                    ...current.preferences,
                    reducedMobility: event.target.checked,
                  },
                }))
              }
              className="mt-1 size-4 shrink-0 accent-primary"
            />
            <span>
              <span className="block text-sm font-bold text-ink">
                <span aria-hidden="true">♿ </span>
                Itinéraires accessibles PMR
              </span>
              {/*
                Le texte dit **exactement** ce que le serveur fait (UF-602) :
                `reducedMobility` est un filtre dur côté API — un itinéraire non
                praticable en fauteuil est écarté, pas rétrogradé
                (`itinerary-merger.ts`). L'ancien « privilégie » laissait croire
                à un simple ordre de préférence : promettre moins que la
                contrainte réelle, c'est laisser l'usager croire qu'il voit
                encore les options écartées (C7 — WCAG 3.3.2, C12).
              */}
              <span id="pmr-hint" className="block text-xs text-ink-700">
                Seuls les itinéraires praticables en fauteuil roulant vous seront proposés —
                stations avec ascenseurs et quais adaptés. Facultatif : cette information sert
                uniquement au calcul de vos itinéraires.
              </span>
            </span>
          </label>

          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="geolocationConsent"
              checked={draft.geolocationConsent}
              aria-describedby="geoloc-hint"
              onChange={(event) =>
                edit((current) => ({ ...current, geolocationConsent: event.target.checked }))
              }
              className="mt-1 size-4 shrink-0 accent-primary"
            />
            <span>
              <span className="block text-sm font-bold text-ink">
                <span aria-hidden="true">📍 </span>
                Géolocalisation
              </span>
              <span id="geoloc-hint" className="block text-xs text-ink-700">
                Autorise UrbanFlow à utiliser votre position pour pré-remplir votre point de départ.
                Consentement RGPD, révocable à tout moment en décochant cette case.
              </span>
            </span>
          </label>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="max-walk" className="text-xs font-bold text-ink">
            Marche maximale par trajet (minutes)
          </label>
          <p id="max-walk-hint" className="text-xs text-ink-500">
            Entre {MAX_WALK_MIN} et {MAX_WALK_MAX} minutes de marche par segment d’itinéraire.
          </p>
          <input
            id="max-walk"
            name="maxWalkMinutes"
            type="number"
            inputMode="numeric"
            min={MAX_WALK_MIN}
            max={MAX_WALK_MAX}
            step={1}
            value={draft.preferences.maxWalkMinutes}
            aria-describedby="max-walk-hint"
            onChange={(event) =>
              edit((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  // `valueAsNumber` vaut NaN quand le champ est vidé : on laisse
                  // passer, la validation s'en charge avec un message explicite.
                  maxWalkMinutes: event.target.valueAsNumber,
                },
              }))
            }
            className="w-28 rounded-md border-2 border-ink-200 bg-white px-[15px] py-3 text-sm text-ink focus:border-action focus:outline-none"
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="primary" size="lg" disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer mes préférences'}
        </Button>
        {notice && (
          <p role="status" className="text-sm font-semibold text-primary-dark">
            {notice}
          </p>
        )}
      </div>
    </form>
  );
}
