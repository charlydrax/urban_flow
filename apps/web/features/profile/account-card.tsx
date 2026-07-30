'use client';

import { useState } from 'react';

import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { useSession } from '../auth/session-provider';
import { initialsFromEmail } from './preferences';

/**
 * Carte d'identité du compte connecté (F1, UF-107) — maquette « 3. PROFIL F1 » :
 * pastille d'initiales, email, et **option de déconnexion**.
 *
 * L'identité vient de `SessionProvider`, déjà hydraté depuis le cookie côté
 * serveur : aucune requête supplémentaire n'est nécessaire pour l'afficher (C5).
 *
 * La déconnexion délègue à `signOut()`, qui purge le cookie `httpOnly` côté API
 * (le JS ne peut pas y toucher — C11) puis vide l'état client et renvoie vers
 * `/login`. Les pages privées deviennent alors inaccessibles : le middleware
 * redirige la navigation et l'API répond 401 (recette 3 du ticket).
 *
 * Accessibilité (C7) : initiales décoratives masquées aux lecteurs d'écran
 * (l'email les précède déjà), zone tactile ≥ 44 px, bouton désactivé et libellé
 * mis à jour pendant la déconnexion.
 */
export function AccountCard() {
  const { user, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  // Le middleware garantit une session sur cette page ; ce garde-fou couvre
  // l'instant de purge, entre le clic sur « Se déconnecter » et la redirection.
  if (!user) return null;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Card className="flex flex-wrap items-center gap-4">
      <span
        aria-hidden="true"
        className="flex size-13 shrink-0 items-center justify-center rounded-full bg-tint-green font-display text-lg font-bold text-primary-dark"
      >
        {initialsFromEmail(user.email)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold break-all text-ink">{user.email}</p>
        <p className="text-xs text-ink-700">Compte UrbanFlow Mobility</p>
      </div>

      <Button variant="outline" onClick={handleSignOut} disabled={signingOut} className="min-h-11">
        {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
      </Button>
    </Card>
  );
}
