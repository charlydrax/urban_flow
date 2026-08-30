'use client';

import { useState } from 'react';

import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { useSession } from '../auth/session-provider';
import { initialsFromEmail } from '../../lib/initials';

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

      {/*
        `basis-48` : c'est lui qui déclenche le repli du bouton (UF-606, C2).

        En `flex-1` seul, la base valait 0 — la ligne « tenait » donc toujours,
        `flex-wrap` ne se déclenchait jamais, et sur un écran de 375 px l'e-mail
        se retrouvait comprimé à ~120 px entre la pastille et le bouton :
        « marie@u / rbanflo / w.dev » sur trois lignes. Avec une base de 12 rem,
        la somme des éléments dépasse la ligne sous ~470 px et le bouton passe
        dessous, à sa taille normale.

        `break-words` et non `break-all` : on ne coupe un mot que s'il ne rentre
        vraiment pas, au lieu de le hacher dès qu'il touche le bord.
      */}
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-bold break-words text-ink">{user.email}</p>
        <p className="text-xs text-ink-700">Compte UrbanFlow Mobility</p>
      </div>

      <Button variant="outline" onClick={handleSignOut} disabled={signingOut} className="min-h-11">
        {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
      </Button>
    </Card>
  );
}
