'use client';

import { FormEvent } from 'react';

/**
 * Formulaire de connexion (F1) — STUB squelette, non câblé.
 *
 * Implémentation cible : `apiClient.login` (le JWT arrive en cookie httpOnly —
 * C11), gestion des erreurs 401 avec message générique (C4), lien vers
 * l'inscription et la politique de confidentialité (C8).
 *
 * Accessibilité (C7) : labels associés, autocomplete standards,
 * erreurs annoncées via aria-live (à venir).
 */
export function LoginForm() {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // TODO(F1): apiClient.login(email, password) + redirection
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex max-w-sm flex-col gap-4 rounded-lg border border-primary/20 bg-white p-4"
    >
      <h2 className="text-lg font-bold text-primary-dark">Connexion</h2>

      <div className="flex flex-col gap-1">
        <label htmlFor="login-email" className="font-medium">
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded border border-primary/40 px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="login-password" className="font-medium">
          Mot de passe
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border border-primary/40 px-3 py-2"
        />
      </div>

      <button
        type="submit"
        className="rounded bg-primary px-4 py-2 font-medium text-white hover:bg-primary-dark"
      >
        Se connecter
      </button>
    </form>
  );
}
