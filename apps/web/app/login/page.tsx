import type { Metadata } from 'next';

import { AuthShell } from '../../features/auth/auth-shell';
import { LoginForm } from '../../features/auth/login-form';

export const metadata: Metadata = {
  title: 'Connexion — UrbanFlow Mobility',
  description:
    'Connectez-vous à votre compte UrbanFlow pour planifier vos itinéraires multimodaux.',
};

/**
 * Page de connexion (F1) — reprise de la maquette Figma « 2. CONNEXION F1 »,
 * carte centrée mobile-first (C2).
 * Le formulaire est un composant client câblé sur l'API ; cette page reste
 * un Server Component pour porter les métadonnées SEO/onglet.
 */
export default function LoginPage() {
  return (
    <AuthShell
      titleId="login-title"
      title={
        <>
          Bon retour <span aria-hidden="true">👋</span>
        </>
      }
      subtitle="Connectez-vous pour reprendre vos trajets là où vous les avez laissés."
      switchPrompt="Pas encore de compte ?"
      switchHref="/register"
      switchLabel="S'inscrire"
    >
      <LoginForm />
    </AuthShell>
  );
}
