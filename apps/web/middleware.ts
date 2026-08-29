import { NextRequest, NextResponse } from 'next/server';

import {
  buildLoginUrl,
  DEFAULT_AFTER_LOGIN,
  isAuthPath,
  isPublicPath,
  readSession,
  SESSION_COOKIE,
} from './lib/session';

/**
 * Middleware de protection des routes (UF-106).
 *
 * Toute page est **privée par défaut** ; seules les routes déclarées publiques
 * dans `lib/session.ts` échappent à la règle. Sans session valide, la navigation
 * est détournée vers `/login?next=<page demandée>` : l'utilisateur retrouve sa
 * page après connexion (recette 3 du ticket UF-106).
 *
 * Symétriquement, un utilisateur déjà connecté qui ouvre `/login` est renvoyé
 * vers l'espace connecté — un formulaire de connexion affiché à quelqu'un de
 * connecté n'a aucun sens.
 *
 * ⚠️ Deux natures de pages publiques, depuis UF-603 : les **écrans
 * d'authentification** (`isAuthPath`), dont on détourne une session valide, et
 * les pages **ouvertes à tous** — la politique de confidentialité — que la
 * session soit présente ou non. Renvoyer un utilisateur connecté vers l'accueil
 * parce qu'il consulte la politique de confidentialité la rendrait illisible à
 * ceux-là mêmes dont elle décrit les données (C8).
 *
 * ⚠️ **Ce middleware est une garde de navigation, pas une frontière de
 * sécurité** : il se contente de lire l'expiration inscrite dans le token, sans
 * en vérifier la signature (le secret JWT ne doit jamais quitter l'API — C4).
 * La vraie protection reste le guard JWT global de l'API Gateway (UF-104), qui
 * répond 401 sur chaque appel : aucune donnée privée ne peut transiter sans un
 * token cryptographiquement valide, même si quelqu'un forgeait un cookie pour
 * atteindre l'écran.
 *
 * Éco-conception / perfs (C5, C10) : la décision se prend en périphérie, avant
 * tout rendu et tout appel API — on n'envoie pas une page qu'on redirigera.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const session = readSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublicPath(pathname)) {
    if (session && isAuthPath(pathname)) {
      return NextResponse.redirect(new URL(DEFAULT_AFTER_LOGIN, request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    // On mémorise le chemin **et** sa query : « /?from=A&to=B » doit être restitué tel quel.
    return NextResponse.redirect(new URL(buildLoginUrl(`${pathname}${search}`), request.url));
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Le middleware ne s'exécute que sur les navigations de pages. On exclut :
   * - `_next/*` (bundles, images optimisées) et les assets statiques : inutile,
   *   et coûteux à chaque requête (C5/C10) ;
   * - `manifest.json`, `sw.js`, `icons/*` : la PWA doit pouvoir s'installer et
   *   enregistrer son service worker sans session (C1) — sinon le navigateur
   *   récupère une redirection HTML à la place du manifeste ;
   * - `favicon.ico`.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js).*)'],
};
