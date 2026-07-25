# `features/auth` — Écrans d'authentification (F1, UF-105)

## Rôle

Interface d'inscription et de connexion de la PWA, câblée sur l'API Gateway NestJS
(`POST /api/auth/register`, `POST /api/auth/login`). Reprend les composants du design
system (UF-007) et la charte Figma.

## Contenu

| Fichier              | Rôle                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| `login-form.tsx`     | Formulaire de connexion (client) — états loading/erreur, redirection. |
| `register-form.tsx`  | Formulaire d'inscription (client) — politique de mot de passe + 409.  |
| `validation.ts`      | Règles de validation côté client (miroir des DTO serveur — testable). |
| `validation.test.ts` | Tests unitaires des règles (Vitest, environnement node).              |

Les pages App Router associées : `app/login/page.tsx` et `app/register/page.tsx`
(Server Components portant les métadonnées, formulaires en composants clients).

## Stratégie de session (rappel UF-103)

Le JWT est émis par l'API dans un **cookie `httpOnly`** (C11) : le front ne stocke
jamais le token en JS. La connexion se matérialise par la redirection vers l'espace
connecté (`/`) suivie d'un `router.refresh()` pour recharger l'état serveur. Le client
API (`lib/api-client.ts`) envoie `credentials: 'include'` pour transporter le cookie.

## Contraintes couvertes

- **C4 / OWASP** : validation côté client en **complément** de la validation serveur
  (jamais à sa place) ; message d'échec de connexion volontairement **générique**
  (ne révèle pas si l'email existe).
- **C7 / WCAG 2.1 AA** : labels associés (`InputField`), erreurs reliées par
  `aria-describedby` et annoncées (`role="alert"`), politique de mot de passe indiquée
  en amont (`hint`), navigation clavier, focus visible, `autoComplete` standards.
- **C11** : cookie `httpOnly` (aucun token en `localStorage`).
- **C2** : cartes centrées mobile-first.

## Recette (UF-105)

1. Un utilisateur peut **s'inscrire** puis **se connecter** de bout en bout.
2. Les erreurs API s'affichent proprement : **email déjà pris** (409, sur le champ),
   **identifiants faux** (401, message générique).
3. Formulaires **accessibles au clavier** avec labels associés (C7).
