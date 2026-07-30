# `features/auth` — Authentification et session (F1, UF-105 / UF-106)

## Rôle

Interface d'inscription et de connexion de la PWA, câblée sur l'API Gateway NestJS
(`POST /api/auth/register`, `POST /api/auth/login`), **et gestion de la session** :
protection des routes privées, état connecté/déconnecté, redirection sur 401 (UF-106).
Reprend les composants du design system (UF-007) et la charte Figma.

## Source du design

Maquette Figma `UrbanFlow Mobility — Maquettes T6 CDSD`, section
**02 · Maquettes mobile → écran « 2. CONNEXION F1 »** (`node-id=14:1101`).

- `/login` **transpose** cet écran : titre display + accroche, champs à icône interne
  (✉ / 🔒), bascule « Voir », ligne « Se souvenir de moi / Oublié ? », bouton primaire
  pleine largeur, séparateur « ou continuer avec », bouton neutre, bascule de bas de carte.
- `/register` est **dérivé** du même gabarit : la maquette ne comporte pas d'écran
  d'inscription. La ligne « Se souvenir de moi » y est remplacée par la politique de
  mot de passe.

La maquette dessine l'écran dans un châssis de téléphone 375 × 812 ; en PWA on rend le
contenu de cet écran : pleine largeur sur mobile, carte centrée à 400 px max dès `sm` (C2).

### Écarts assumés par rapport à la maquette

| Élément                               | Écart                                                         | Raison                                                                                               |
| ------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| « ou continuer avec »                 | Gris `Ink 500` au lieu du `#9aa3b5` de la maquette            | `#9aa3b5` sur blanc = 2,6:1, sous le seuil AA de 4,5:1 (C7)                                          |
| Bouton `G · Google`                   | Affiché mais **désactivé**, annoncé « fonctionnalité prévue » | Pas de fédération d'identité au périmètre (UF-102/103 = email + mot de passe)                        |
| « Se souvenir de moi » / « Oublié ? » | Affichés mais **désactivés**, même annonce                    | Cookie de session à durée fixe (UF-103) et aucune route de réinitialisation : pas d'action à simuler |

## Contenu

| Fichier                | Rôle                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `auth-shell.tsx`       | Habillage commun (carte, titre, accroche, bloc social, bascule) — serveur.  |
| `login-form.tsx`       | Formulaire de connexion (client) — états loading/erreur, retour sur `next`. |
| `register-form.tsx`    | Formulaire d'inscription (client) — politique de mot de passe + 409.        |
| `password-field.tsx`   | Champ mot de passe avec bascule « Voir / Masquer » accessible.              |
| `session-provider.tsx` | État de session (UF-106) : `useSession()`, purge sur 401, `signOut()`.      |
| `validation.ts`        | Règles de validation côté client (miroir des DTO serveur — testable).       |
| `validation.test.ts`   | Tests unitaires des règles (Vitest, environnement node).                    |

Modules de session hors dossier (réutilisés par le middleware et le rendu serveur) :

| Fichier                 | Rôle                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| `middleware.ts`         | Garde de navigation : page privée sans session → `/login?next=…`.                 |
| `lib/session.ts`        | Primitives pures : lecture du token, expiration, assainissement de `next`.        |
| `lib/session-server.ts` | Lecture de la session dans les Server Components (`cookies()`).                   |
| `lib/api-client.ts`     | Intercepteur `401` → notification de session morte + `getSession()` / `logout()`. |

Les pages App Router associées : `app/login/page.tsx` et `app/register/page.tsx`
(Server Components portant les métadonnées et l'habillage, formulaires en composants
clients — le JS envoyé au navigateur se limite aux formulaires, C5/C10).

Composants du design system étendus pour ces écrans (UF-007) :
`InputField` (props `leadingIcon` / `trailing`, focus porté par le conteneur) et
`Button` (variante `neutral`).

## Stratégie de session (UF-103 + UF-106)

Le JWT est émis par l'API dans un **cookie `httpOnly`** (C11) : le front ne stocke
jamais le token en JS. Le client API (`lib/api-client.ts`) envoie
`credentials: 'include'` pour le transporter.

### Trois niveaux, un seul gardien réel

| Niveau                              | Rôle                                                        | Frontière de sécurité ?                          |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| `middleware.ts`                     | Empêche d'**afficher** une page privée sans session         | ❌ confort de navigation                         |
| `SessionProvider` + intercepteur    | Réagit à un `401` : purge + retour `/login`                 | ❌ réaction, pas prévention                      |
| Guard JWT de l'API Gateway (UF-104) | Vérifie **signature + expiration** sur chaque appel → `401` | ✅ **le seul** — aucune donnée sans token valide |

Le middleware lit l'`exp` inscrit dans le token **sans vérifier la signature** : le
`JWT_SECRET` ne doit jamais quitter l'API (C4). Un cookie forgé permettrait donc
d'atteindre l'écran, mais celui-ci resterait vide — chaque appel API serait rejeté en
`401`, ce qui déclencherait immédiatement la purge et le retour à la connexion.

### Cycle de vie

1. **Connexion** → cookie posé par l'API, `router.replace(next ?? '/')` puis
   `router.refresh()` pour recharger l'état serveur.
2. **Navigation sans session** → le middleware redirige vers
   `/login?reason=auth-required&next=<page demandée>`.
3. **Session morte en cours d'usage** → un appel API renvoie `401` → le client API
   prévient `SessionProvider` → `POST /auth/logout` (purge du cookie `httpOnly`, seule
   l'API peut l'effacer) → `/login?reason=session-expired&next=<page en cours>`.
4. **Retour sur un onglet laissé ouvert** → revalidation via `GET /auth/me`.
   Événementiel (`visibilitychange` / `focus`), **jamais de polling** (C5).
5. **Déconnexion volontaire** → `signOut()` → purge + `/login?reason=signed-out`.

L'état initial est résolu **côté serveur** (`getServerSession()` dans le layout) : pas
de flash « déconnecté » ni d'appel API au chargement (C5, C10).

### Périmètre public

Tout est **privé par défaut** : seuls `/login` et `/register` sont publics
(`PUBLIC_PATHS` dans `lib/session.ts`). Un oubli ferme donc la porte au lieu de
l'ouvrir. Le middleware laisse en revanche passer `manifest.json`, `sw.js` et
`icons/*` sans session : sinon la PWA ne pourrait plus s'installer ni enregistrer son
service worker (C1).

### Redirection ouverte (C4 / OWASP A01)

Le paramètre `next` vient de l'URL : il est traité comme une entrée hostile et passé par
`sanitizeNextPath()`, qui n'accepte qu'un chemin interne (`/…`). `https://evil.tld`,
`//evil.tld`, `/\evil.tld` et `javascript:` sont rejetés — sans quoi l'écran de connexion
deviendrait un tremplin de phishing. Couvert par `lib/session.test.ts`.

## Contraintes couvertes

- **C4 / OWASP** : validation côté client en **complément** de la validation serveur
  (jamais à sa place) ; message d'échec de connexion volontairement **générique**
  (ne révèle pas si l'email existe) ; routes privées par défaut et `next` assaini
  contre la redirection ouverte (A01).
- **C7 / WCAG 2.1 AA** : labels associés (`InputField`), erreurs reliées par
  `aria-describedby` et annoncées (`role="alert"`), politique de mot de passe indiquée
  en amont (`hint`), navigation clavier, focus visible (bordure + halo sur le conteneur
  de champ), bascule « Voir » en vrai `<button>` avec cible ≥ 24 px, contrastes AA.
- **C11** : cookie `httpOnly` (aucun token en `localStorage`) ; la bascule de visibilité
  du mot de passe reste purement locale à l'affichage ; la déconnexion passe par l'API,
  seule capable d'effacer ce cookie.
- **C2** : mobile-first — pleine largeur à 375 px, carte centrée au-delà ; bouton de
  déconnexion à cible tactile ≥ 44 px dans le menu replié.
- **C5 / C10** : habillage en Server Components, seuls les formulaires sont hydratés ;
  état de session résolu au rendu serveur (pas d'appel au chargement) et revalidation
  **événementielle** au retour d'onglet (pas de polling).

## Recette (UF-105)

1. Un utilisateur peut **s'inscrire** puis **se connecter** de bout en bout.
2. Les erreurs API s'affichent proprement : **email déjà pris** (409, sur le champ),
   **identifiants faux** (401, message générique).
3. Formulaires **accessibles au clavier** avec labels associés (C7).

## Recette (UF-106)

1. Ouvrir `/` sans être connecté → redirection vers `/login`, message
   « Connectez-vous pour accéder à cette page ».
2. Supprimer le cookie `access_token` (DevTools → Application → Cookies) puis revenir sur
   l'onglet, ou attendre l'expiration (`JWT_EXPIRES_IN`, 15 min par défaut) → retour
   automatique vers `/login` avec « Votre session a expiré ».
3. Après connexion, l'utilisateur **revient sur la page qu'il demandait** (`?next=`).
4. Le header reflète l'état : email + « Déconnexion » connecté, « Connexion » sinon.

Tests automatisés : `middleware.test.ts` (redirections, `next`, token expiré),
`lib/session.test.ts` (expiration, redirection ouverte),
`apps/api/src/modules/auth/auth.controller.spec.ts` (401 de `/auth/me`, purge du cookie).
