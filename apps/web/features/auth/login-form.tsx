'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { Button } from '../../components/ui/button';
import { InputField } from '../../components/ui/input-field';
import { ApiError, apiClient } from '../../lib/api-client';
import { DEFAULT_AFTER_LOGIN } from '../../lib/session';
import { PasswordField } from './password-field';
import { validateEmail } from './validation';

export interface LoginFormProps {
  /**
   * Page privée demandée avant la redirection vers la connexion (UF-106).
   * Déjà **assainie côté serveur** par `sanitizeNextPath` : ce composant ne
   * reçoit qu'un chemin interne, jamais une URL absolue (anti-redirection
   * ouverte — C4).
   */
  nextPath?: string | null;
}

/**
 * Formulaire de connexion (F1) — câblé sur `POST /api/auth/login`, mis en forme
 * d'après la maquette Figma « 02 · Maquettes mobile — 2. CONNEXION F1 ».
 *
 * Le JWT est posé par l'API dans un cookie `httpOnly` (C11) : rien n'est stocké
 * côté JS, la connexion se matérialise par la simple redirection vers l'espace
 * connecté. En cas d'échec, un message **générique** est affiché (C4/OWASP :
 * ne pas révéler si l'email existe).
 *
 * Accessibilité (C7) : titre de carte relié par `aria-labelledby`, labels
 * associés (InputField), erreur de formulaire annoncée via `role="alert"` +
 * `aria-live`, bouton désactivé pendant l'envoi, `autoComplete` standards pour
 * les gestionnaires de mots de passe.
 *
 * Après succès, l'utilisateur revient sur la page qu'il demandait (`nextPath`)
 * si elle est connue, sinon sur l'espace connecté (UF-106, recette 3).
 */
export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const emailProblem = validateEmail(email);
    setEmailError(emailProblem);
    if (emailProblem || password.length === 0) {
      if (!emailProblem) setFormError('Veuillez saisir votre mot de passe.');
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.login(email.trim(), password);
      // Le cookie httpOnly est posé : on rafraîchit pour recharger l'état serveur.
      // `replace` : l'écran de connexion ne doit pas rester dans l'historique
      // (un retour arrière y renverrait un utilisateur désormais connecté).
      router.replace(nextPath ?? DEFAULT_AFTER_LOGIN);
      router.refresh();
    } catch (error) {
      // Message volontairement générique quelle que soit la cause (C4/OWASP).
      setFormError(
        error instanceof ApiError && error.status === 401
          ? 'Email ou mot de passe incorrect.'
          : 'Connexion impossible pour le moment. Veuillez réessayer.',
      );
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby="login-title"
      className="mt-6 flex flex-col gap-3.5"
    >
      {formError && (
        <p
          role="alert"
          className="rounded-md border-2 border-error bg-tint-red px-4 py-3 text-sm font-semibold text-error"
        >
          {formError}
        </p>
      )}

      <InputField
        label="Email"
        id="login-email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="marie.dupont@email.fr"
        leadingIcon="✉"
        required
        value={email}
        error={emailError ?? undefined}
        onChange={(event) => setEmail(event.target.value)}
      />

      <PasswordField
        label="Mot de passe"
        id="login-password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {/*
       * Ligne « Se souvenir de moi / Oublié ? » de la maquette. Aucune des deux
       * options n'a de contrepartie API dans le prototype (UF-103 émet un cookie
       * de session à durée fixe, et aucune route de réinitialisation n'existe) :
       * elles sont affichées désactivées et annoncées comme telles, plutôt que
       * de proposer une action sans effet.
       */}
      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-xs text-ink-700 has-[:disabled]:text-ink-500">
          <input
            type="checkbox"
            disabled
            aria-describedby="login-soon"
            className="size-4 shrink-0 accent-primary"
          />
          Se souvenir de moi
        </label>
        <button
          type="button"
          disabled
          aria-describedby="login-soon"
          className="text-xs font-bold text-action-dark hover:underline disabled:text-ink-500 disabled:no-underline"
        >
          Oublié ?
        </button>
      </div>
      <p id="login-soon" className="sr-only">
        Fonctionnalité prévue après le prototype.
      </p>

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting}>
        {submitting ? 'Connexion…' : 'Se connecter'}
      </Button>
    </form>
  );
}
