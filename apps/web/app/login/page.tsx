import type { Metadata } from 'next';

import { AuthShell } from '../../features/auth/auth-shell';
import { LoginForm } from '../../features/auth/login-form';
import { LogoutReason, NEXT_PARAM, REASON_PARAM, sanitizeNextPath } from '../../lib/session';

export const metadata: Metadata = {
  title: 'Connexion — UrbanFlow Mobility',
  description:
    'Connectez-vous à votre compte UrbanFlow pour planifier vos itinéraires multimodaux.',
};

/** Message d'explication affiché quand l'utilisateur arrive ici par redirection (UF-106, C7). */
const REASON_MESSAGES: Record<LogoutReason, string> = {
  'auth-required': 'Connectez-vous pour accéder à cette page.',
  'session-expired': 'Votre session a expiré. Reconnectez-vous pour continuer.',
  'signed-out': 'Vous avez été déconnecté.',
};

function isLogoutReason(value: string | undefined): value is LogoutReason {
  return value === 'auth-required' || value === 'session-expired' || value === 'signed-out';
}

/**
 * Page de connexion (F1) — reprise de la maquette Figma « 2. CONNEXION F1 »,
 * carte centrée mobile-first (C2).
 *
 * Point d'arrivée des redirections de session (UF-106) : `?reason=` explique
 * pourquoi l'utilisateur a été renvoyé ici, `?next=` mémorise la page qu'il
 * demandait pour l'y ramener après connexion. Le `next` est **assaini côté
 * serveur** avant d'atteindre le formulaire (anti-redirection ouverte — C4).
 *
 * Reste un Server Component : il porte les métadonnées et l'analyse de l'URL,
 * seul le formulaire est hydraté (C5/C10).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawReason = Array.isArray(params[REASON_PARAM]) ? undefined : params[REASON_PARAM];
  const rawNext = Array.isArray(params[NEXT_PARAM]) ? undefined : params[NEXT_PARAM];
  const notice = isLogoutReason(rawReason) ? REASON_MESSAGES[rawReason] : null;

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
      {notice && (
        /* `status` : annoncé sans interrompre, contrairement à `alert` réservé
           aux erreurs de saisie du formulaire (C7). */
        <p
          role="status"
          className="mt-4 rounded-md border border-ink-200 bg-surface-muted px-4 py-3 text-sm text-ink-700"
        >
          {notice}
        </p>
      )}
      <LoginForm nextPath={sanitizeNextPath(rawNext)} />
    </AuthShell>
  );
}
