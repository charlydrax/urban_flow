import type { Metadata } from 'next';

import { LoginForm } from '../../features/auth/login-form';

export const metadata: Metadata = {
  title: 'Connexion — UrbanFlow Mobility',
  description:
    'Connectez-vous à votre compte UrbanFlow pour planifier vos itinéraires multimodaux.',
};

/**
 * Page de connexion (F1) — carte centrée, mobile-first (C2).
 * Le formulaire est un composant client câblé sur l'API ; cette page reste
 * un Server Component pour porter les métadonnées SEO/onglet.
 */
export default function LoginPage() {
  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rounded-lg border border-ink-200 bg-white p-6 shadow-card">
        <LoginForm />
      </div>
    </div>
  );
}
