'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

import { Button } from '../../components/ui/button';
import { InputField } from '../../components/ui/input-field';
import { ApiError, apiClient } from '../../lib/api-client';
import { PasswordField } from './password-field';
import { PASSWORD_HINT, validateEmail, validatePassword } from './validation';

/** Destination après inscription réussie : l'espace connecté (planificateur). */
const AFTER_AUTH_REDIRECT = '/';

/**
 * Formulaire d'inscription (F1) — câblé sur `POST /api/auth/register`.
 *
 * La maquette Figma ne comporte pas d'écran d'inscription : cet écran est
 * **dérivé** de « 2. CONNEXION F1 » (mêmes champs, mêmes gabarits, même bascule
 * de bas de carte), la politique de mot de passe prenant la place laissée libre.
 *
 * Applique la politique de mot de passe OWASP côté client (retour immédiat),
 * la validation serveur restant la source de vérité (C4). Le JWT est posé en
 * cookie `httpOnly` par l'API (C11) : après succès, redirection directe vers
 * l'espace connecté (l'utilisateur est connecté d'emblée).
 *
 * Accessibilité (C7) : labels + `aria-describedby` (via InputField), politique
 * de mot de passe annoncée en amont (`hint`), erreurs par champ reliées, erreur
 * globale (ex. email déjà pris) annoncée via `role="alert"`.
 */
export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const emailProblem = validateEmail(email);
    const passwordProblem = validatePassword(password);
    setEmailError(emailProblem);
    setPasswordError(passwordProblem);
    if (emailProblem || passwordProblem) return;

    setSubmitting(true);
    try {
      await apiClient.register(email.trim(), password);
      // Compte créé + cookie httpOnly posé : on entre directement connecté.
      router.push(AFTER_AUTH_REDIRECT);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // 409 Conflict = email déjà utilisé : erreur ciblée sur le champ email (C7).
        setEmailError('Cette adresse email est déjà utilisée.');
      } else {
        setFormError('Inscription impossible pour le moment. Veuillez réessayer.');
      }
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby="register-title"
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
        id="register-email"
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
        id="register-password"
        name="password"
        autoComplete="new-password"
        required
        hint={PASSWORD_HINT}
        value={password}
        error={passwordError ?? undefined}
        onChange={(event) => setPassword(event.target.value)}
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="mt-0.5 w-full"
        disabled={submitting}
      >
        {submitting ? 'Création…' : 'Créer mon compte'}
      </Button>
    </form>
  );
}
