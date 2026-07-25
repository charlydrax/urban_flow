import type { Metadata } from 'next';

import { RegisterForm } from '../../features/auth/register-form';

export const metadata: Metadata = {
  title: 'Inscription — UrbanFlow Mobility',
  description: 'Créez votre compte UrbanFlow pour des itinéraires urbains plus durables.',
};

/**
 * Page d'inscription (F1) — carte centrée, mobile-first (C2).
 * Server Component qui porte les métadonnées ; le formulaire câblé est un
 * composant client (`RegisterForm`).
 */
export default function RegisterPage() {
  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rounded-lg border border-ink-200 bg-white p-6 shadow-card">
        <RegisterForm />
      </div>
    </div>
  );
}
