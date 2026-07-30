import type { Metadata } from 'next';

import { AuthShell } from '../../features/auth/auth-shell';
import { RegisterForm } from '../../features/auth/register-form';

export const metadata: Metadata = {
  title: 'Inscription — UrbanFlow Mobility',
  description: 'Créez votre compte UrbanFlow pour des itinéraires urbains plus durables.',
};

/**
 * Page d'inscription (F1) — carte centrée, mobile-first (C2).
 * Écran absent de la maquette Figma : décliné du gabarit « 2. CONNEXION F1 »
 * (mêmes composants, même charte). Server Component qui porte les métadonnées ;
 * le formulaire câblé est un composant client (`RegisterForm`).
 */
export default function RegisterPage() {
  return (
    <AuthShell
      titleId="register-title"
      title={
        <>
          Créer un compte <span aria-hidden="true">🚲</span>
        </>
      }
      subtitle="Vélo'v, métro, tram, bus, trottinette : combinez tous les transports de Lyon en un seul geste."
      switchPrompt="Déjà inscrit ?"
      switchHref="/login"
      switchLabel="Se connecter"
    >
      <RegisterForm />
    </AuthShell>
  );
}
