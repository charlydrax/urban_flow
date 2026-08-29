'use client';

import type { SessionUser } from '@urbanflow/shared';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { apiClient, setUnauthorizedHandler } from '../../lib/api-client';
import { buildLoginUrl, LogoutReason } from '../../lib/session';

/** État de session exposé à l'arbre React. */
export interface SessionState {
  /** Utilisateur connecté, ou `null`. */
  user: SessionUser | null;
  /** Raccourci de lisibilité pour les rendus conditionnels. */
  status: 'authenticated' | 'unauthenticated';
  /** Déconnexion volontaire : purge le cookie côté API puis renvoie vers /login. */
  signOut: () => Promise<void>;
  /**
   * Purge **locale** de la session, sans appel réseau (UF-603).
   *
   * Réservé au cas où l'API a déjà supprimé le cookie de son côté — la
   * suppression de compte. Rappeler `/auth/logout` y serait un aller-retour pour
   * effacer un cookie qui n'existe plus (C5), et masquerait le vrai motif de
   * redirection derrière un « vous avez été déconnecté » trompeur.
   */
  forgetSession: (reason: LogoutReason) => void;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Fournit l'état de session à toute la PWA (UF-106).
 *
 * L'état initial vient du **serveur** (`getServerSession()` dans le layout) : le
 * header s'affiche du premier coup dans le bon état, sans flash « déconnecté »
 * ni requête au chargement (C5, C10).
 *
 * Deux façons de perdre sa session, toutes deux traitées ici :
 *  1. **En cours d'usage** — un appel API renvoie 401 (token expiré ou révoqué) :
 *     le client API nous prévient, on purge et on renvoie vers `/login` en
 *     mémorisant la page en cours (recettes 2 et 3 du ticket).
 *  2. **Onglet laissé ouvert** — au retour sur l'onglet, on revalide la session
 *     auprès de l'API. Revalidation **événementielle, jamais périodique** : pas
 *     de polling, donc pas de requêtes ni de batterie gaspillées (C5).
 *
 * Le token lui-même n'est jamais lu ni stocké côté JS : il reste dans le cookie
 * `httpOnly` (C11).
 */
export function SessionProvider({
  initialUser,
  children,
}: {
  initialUser: SessionUser | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(initialUser);

  // Le chemin courant est lu dans des rappels non réactifs (handler 401,
  // écouteurs d'événements) : une ref évite de les réabonner à chaque navigation.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // Une session peut mourir pendant plusieurs appels parallèles : sans ce
  // verrou, chacun déclencherait sa propre redirection.
  const expiringRef = useRef(false);

  /** L'état serveur fait foi après chaque navigation / router.refresh(). */
  useEffect(() => {
    setUser(initialUser);
    if (initialUser) expiringRef.current = false;
  }, [initialUser]);

  /** Purge locale + retour à la connexion, en mémorisant la page demandée. */
  const endSession = useCallback(
    (reason: LogoutReason) => {
      setUser(null);
      // Session perdue subie → on retiendra la page pour y revenir après
      // reconnexion ; déconnexion volontaire → l'utilisateur repart de zéro.
      const target =
        reason === 'session-expired'
          ? buildLoginUrl(pathnameRef.current, reason)
          : buildLoginUrl(null, reason);
      // `replace` : la page privée ne doit pas rester dans l'historique
      // (retour arrière → écran privé vide).
      router.replace(target);
      // Invalide le rendu serveur (header, Server Components) après la purge.
      router.refresh();
    },
    [router],
  );

  /** Branche l'intercepteur 401 du client API sur cette session. */
  useEffect(() => {
    return setUnauthorizedHandler(() => {
      if (expiringRef.current) return;
      expiringRef.current = true;
      // Le cookie httpOnly survit au 401 : seule l'API peut l'effacer.
      void apiClient.logout().finally(() => endSession('session-expired'));
    });
  }, [endSession]);

  /** Revalidation au retour sur l'onglet (voir plus haut : pas de polling — C5). */
  useEffect(() => {
    if (!user) return;

    const revalidate = () => {
      if (document.visibilityState !== 'visible' || expiringRef.current) return;
      // Un 401 est capté par l'intercepteur ci-dessus, qui gère purge + redirection.
      void apiClient.getSession().catch(() => undefined);
    };

    document.addEventListener('visibilitychange', revalidate);
    window.addEventListener('focus', revalidate);
    return () => {
      document.removeEventListener('visibilitychange', revalidate);
      window.removeEventListener('focus', revalidate);
    };
  }, [user]);

  const signOut = useCallback(async () => {
    expiringRef.current = true;
    try {
      await apiClient.logout();
    } finally {
      // Même en cas d'échec réseau, on rend la main à l'écran de connexion :
      // laisser l'utilisateur sur une page privée serait pire (C4).
      endSession('signed-out');
    }
  }, [endSession]);

  /** Purge locale : la session est déjà morte côté serveur, il n'y a rien à demander. */
  const forgetSession = useCallback(
    (reason: LogoutReason) => {
      expiringRef.current = true;
      endSession(reason);
    },
    [endSession],
  );

  return (
    <SessionContext.Provider
      value={{ user, status: user ? 'authenticated' : 'unauthenticated', signOut, forgetSession }}
    >
      {children}
    </SessionContext.Provider>
  );
}

/**
 * Accès à l'état de session depuis un composant client.
 * @throws Error si utilisé hors de `SessionProvider` (erreur de câblage)
 */
export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a <SessionProvider>');
  }
  return context;
}
