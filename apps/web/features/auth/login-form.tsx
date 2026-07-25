'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { Button } from '../../components/ui/button';
import { InputField } from '../../components/ui/input-field';
import { ApiError, apiClient } from '../../lib/api-client';
import { validateEmail } from './validation';

/** Destination après authentification réussie : l'espace connecté (planificateur). */
const AFTER_AUTH_REDIRECT = '/';

/**
 * Formulaire de connexion (F1) — câblé sur `POST /api/auth/login`.
 *
 * Le JWT est posé par l'API dans un cookie `httpOnly` (C11) : rien n'est stocké
 * côté JS, la connexion se matérialise par la simple redirection vers l'espace
 * connecté. En cas d'échec, un message **générique** est affiché (C4/OWASP :
 * ne pas révéler si l'email existe).
 *
 * Accessibilité (C7) : labels associés (InputField), erreur de formulaire
 * annoncée via `role="alert"` + `aria-live`, bouton désactivé pendant l'envoi,
 * `autoComplete` standards pour les gestionnaires de mots de passe.
 */
export function LoginForm() {
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
      router.push(AFTER_AUTH_REDIRECT);
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
      className="flex flex-col gap-4"
    >
      <h1 id="login-title" className="font-display text-2xl font-bold text-primary-dark">
        Connexion
      </h1>

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
        autoComplete="email"
        required
        value={email}
        error={emailError ?? undefined}
        onChange={(event) => setEmail(event.target.value)}
      />

      <InputField
        label="Mot de passe"
        id="login-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      <Button type="submit" variant="primary" size="lg" disabled={submitting}>
        {submitting ? 'Connexion…' : 'Se connecter'}
      </Button>

      <p className="text-sm text-ink-500">
        Pas encore de compte ?{' '}
        <a href="/register" className="font-semibold text-action-dark underline underline-offset-4">
          Créer un compte
        </a>
      </p>
    </form>
  );
}
