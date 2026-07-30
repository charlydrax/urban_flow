import type { SessionUser } from '@urbanflow/shared';
import { cookies } from 'next/headers';

import { readSession, SESSION_COOKIE } from './session';

/**
 * Lit la session côté serveur (Server Components, layouts) — UF-106.
 *
 * Isolé de `lib/session.ts` parce que `next/headers` n'est utilisable que dans
 * le rendu serveur : garder les primitives pures dans un module séparé permet
 * de les réutiliser dans le middleware et de les tester sans Next.
 *
 * Fournit l'état de session **au premier rendu** : le header s'affiche
 * directement dans le bon état, sans flash « déconnecté » ni appel API au
 * chargement (C5 éco-conception, C10 perfs).
 *
 * @returns L'utilisateur du cookie, ou `null` si aucune session exploitable
 */
export async function getServerSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  return readSession(cookieStore.get(SESSION_COOKIE)?.value);
}
