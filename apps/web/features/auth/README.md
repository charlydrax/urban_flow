# `features/auth` — Écrans d'authentification (F1, UF-105)

## Rôle

Interface d'inscription et de connexion de la PWA, câblée sur l'API Gateway NestJS
(`POST /api/auth/register`, `POST /api/auth/login`). Reprend les composants du design
system (UF-007) et la charte Figma.

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

| Fichier              | Rôle                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `auth-shell.tsx`     | Habillage commun (carte, titre, accroche, bloc social, bascule) — serveur. |
| `login-form.tsx`     | Formulaire de connexion (client) — états loading/erreur, redirection.      |
| `register-form.tsx`  | Formulaire d'inscription (client) — politique de mot de passe + 409.       |
| `password-field.tsx` | Champ mot de passe avec bascule « Voir / Masquer » accessible.             |
| `validation.ts`      | Règles de validation côté client (miroir des DTO serveur — testable).      |
| `validation.test.ts` | Tests unitaires des règles (Vitest, environnement node).                   |

Les pages App Router associées : `app/login/page.tsx` et `app/register/page.tsx`
(Server Components portant les métadonnées et l'habillage, formulaires en composants
clients — le JS envoyé au navigateur se limite aux formulaires, C5/C10).

Composants du design system étendus pour ces écrans (UF-007) :
`InputField` (props `leadingIcon` / `trailing`, focus porté par le conteneur) et
`Button` (variante `neutral`).

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
  en amont (`hint`), navigation clavier, focus visible (bordure + halo sur le conteneur
  de champ), bascule « Voir » en vrai `<button>` avec cible ≥ 24 px, contrastes AA.
- **C11** : cookie `httpOnly` (aucun token en `localStorage`) ; la bascule de visibilité
  du mot de passe reste purement locale à l'affichage.
- **C2** : mobile-first — pleine largeur à 375 px, carte centrée au-delà.
- **C5 / C10** : habillage en Server Components, seuls les formulaires sont hydratés.

## Recette (UF-105)

1. Un utilisateur peut **s'inscrire** puis **se connecter** de bout en bout.
2. Les erreurs API s'affichent proprement : **email déjà pris** (409, sur le champ),
   **identifiants faux** (401, message générique).
3. Formulaires **accessibles au clavier** avec labels associés (C7).
