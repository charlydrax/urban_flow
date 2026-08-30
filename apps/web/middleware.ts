import { NextRequest, NextResponse } from 'next/server';

import { buildContentSecurityPolicy } from './lib/security-headers';
import {
  buildLoginUrl,
  DEFAULT_AFTER_LOGIN,
  isAuthPath,
  isPublicPath,
  readSession,
  SESSION_COOKIE,
} from './lib/session';

/**
 * Middleware de protection des routes (UF-106) et de pose de la CSP (UF-604).
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
 * les pages **ouvertes à tous** — la politique de confidentialité, et depuis
 * UF-801 le planificateur lui-même — que la session soit présente ou non.
 * Renvoyer un utilisateur connecté vers l'accueil parce qu'il consulte la
 * politique de confidentialité la rendrait illisible à ceux-là mêmes dont elle
 * décrit les données (C8) ; et détourner l'accueil vers `/login` interdirait à
 * un visiteur de chercher son bus.
 *
 * ⚠️ L'accès invité d'UF-801 **n'élargit pas** la règle : `/impact`, `/profil`
 * et toute page à venir restent privées par défaut, et le planificateur ne
 * devient public que parce qu'il est nommément inscrit dans `OPEN_PATHS`. Un
 * oubli d'inscription ferme toujours la porte, il ne l'ouvre pas.
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
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = readSession(token);
  // Un cookie qu'on n'arrive pas à lire (expiré, tronqué) n'est plus une
  // session : c'est un reliquat, et depuis UF-801 c'est un reliquat nuisible.
  const staleCookie = Boolean(token) && session === null;

  // UF-604 : un nonce neuf par requête — c'est ce qui rend la CSP efficace
  // contre le XSS. Réutiliser le même d'une réponse à l'autre reviendrait à le
  // publier, et un script injecté n'aurait qu'à le recopier.
  const csp = buildContentSecurityPolicy({
    nonce: crypto.randomUUID(),
    isDev: process.env.NODE_ENV !== 'production',
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    mapStyleUrl: process.env.NEXT_PUBLIC_MAP_STYLE_URL,
  });

  if (isPublicPath(pathname)) {
    if (session && isAuthPath(pathname)) {
      return withCsp(NextResponse.redirect(new URL(DEFAULT_AFTER_LOGIN, request.url)), csp);
    }
    return purgeStaleSession(renderWithCsp(request, csp), staleCookie);
  }

  if (!session) {
    // On mémorise le chemin **et** sa query : « /?from=A&to=B » doit être restitué tel quel.
    return purgeStaleSession(
      withCsp(
        NextResponse.redirect(new URL(buildLoginUrl(`${pathname}${search}`), request.url)),
        csp,
      ),
      staleCookie,
    );
  }

  return renderWithCsp(request, csp);
}

/**
 * Efface un cookie de session devenu illisible (UF-801).
 *
 * ## Le cas que ça règle
 *
 * Avant UF-801, un cookie périmé n'allait jamais bien loin : la page suivante
 * était privée, le middleware redirigeait vers `/login`, et la reconnexion
 * réécrivait le cookie. Maintenant que le planificateur est public, ce même
 * visiteur atteint l'écran — mais son navigateur continue de joindre le jeton
 * mort à chaque appel. Or `POST /routes/plan` refuse un jeton présenté et
 * invalide (c'est délibéré : une session morte doit se dire, cf.
 * `OptionalAuth`). Le visiteur se retrouverait donc devant un planificateur
 * ouvert qui refuse de calculer, sans qu'aucune action de sa part n'en sorte :
 * il n'est pas connecté, il n'a donc rien à déconnecter.
 *
 * Purger le cookie au passage referme la boucle — la requête suivante ne
 * présente plus rien, et l'API la sert comme celle de n'importe quel invité.
 *
 * L'effacement demande **les mêmes attributs qu'à la pose**, sans quoi le
 * navigateur ne reconnaît pas le cookie visé : `path: '/'`, celui de
 * `AUTH_COOKIE_OPTIONS` côté API.
 *
 * ⚠️ Ne s'applique qu'aux jetons illisibles ou expirés — jamais à une session
 * valide, qui ne passe pas par ici.
 *
 * @param response Réponse déjà construite (rendu ou redirection)
 * @param stale `true` si un cookie était présent sans donner de session
 */
function purgeStaleSession(response: NextResponse, stale: boolean): NextResponse {
  if (stale) response.cookies.delete({ name: SESSION_COOKIE, path: '/' });
  return response;
}

/** Pose l'en-tête CSP sur une réponse déjà construite (redirections comprises). */
function withCsp(response: NextResponse, csp: string): NextResponse {
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

/**
 * Laisse passer la requête vers le rendu, avec la CSP posée des deux côtés.
 *
 * La recopier sur les en-têtes **de la requête** n'est pas une redondance :
 * c'est ainsi que Next.js y lit le nonce du jour et l'applique aux `<script>`
 * qu'il injecte lui-même (hydratation, chargement des chunks). Sans cela, la
 * politique bloquerait l'application avant tout attaquant.
 */
function renderWithCsp(request: NextRequest, csp: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);

  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp);
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
   *
   * Ces réponses-là ne portent donc pas la CSP, et n'en ont pas besoin : une
   * CSP ne s'applique qu'au document qui l'a reçue. Les en-têtes de sécurité
   * qui, eux, comptent partout (nosniff, X-Frame-Options…) sont posés par
   * `next.config.ts` sur toutes les routes (UF-604).
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js).*)'],
};
