# `common` — Socle transverse de l'API Gateway

Briques partagées par tous les modules : sécurité JWT, gestion d'erreurs, énumérations métier.

## Vérification JWT (UF-104)

C'est l'étape 2 du flux de référence (CLAUDE.md §4) : l'API Gateway authentifie chaque
requête et renvoie `401` sur token absent, invalide ou expiré (ce qui déclenche la
redirection front vers la page de connexion).

| Élément          | Fichier                                | Rôle                                                                                                                                                                         |
| ---------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JwtStrategy`    | `strategies/jwt.strategy.ts`           | Extrait le token (cookie httpOnly `access_token` en priorité, repli `Authorization: Bearer`), vérifie signature + expiration, expose `{ userId, email }` sur `request.user`. |
| `JwtAuthGuard`   | `guards/jwt-auth.guard.ts`             | Guard **global** (`APP_GUARD` dans `app.module.ts`) : tout endpoint est protégé par défaut, sauf `@Public()`.                                                                |
| `@Public()`      | `decorators/public.decorator.ts`       | Opt-out explicite pour les routes ouvertes (`login`, `register`, `health`).                                                                                                  |
| `@CurrentUser()` | `decorators/current-user.decorator.ts` | Injecte l'utilisateur authentifié dans un paramètre de contrôleur. L'identité vient **toujours** du token vérifié, jamais du corps (anti-usurpation / IDOR).                 |

### Sécurité par défaut

Le guard est appliqué globalement : oublier de protéger une route n'ouvre pas de faille,
c'est l'inverse — il faut un `@Public()` explicite pour exposer une route (C4). Le token
est lu en priorité depuis un **cookie httpOnly** (inaccessible au JS → anti-XSS, C11).

### Route protégée de référence

`GET /api/users/me` (module `users`) : protégée par le guard, renvoie le profil du compte
connecté à partir de `@CurrentUser().userId`.

### Tests (recette du ticket)

`guards/jwt-auth.guard.spec.ts` démarre une app Nest réelle et interroge une route
protégée via HTTP :

- route protégée **sans token** → `401` ;
- token **falsifié** (mauvaise signature) ou **expiré** → `401` ;
- token **valide** → `200` + `userId` exposé (issu du `sub`) ;
- route `@Public()` → accessible sans token.

```bash
cd apps/api
npx jest src/common/guards/jwt-auth.guard.spec.ts
```

## Limitation de débit (UF-604)

Plafonds de requêtes **par adresse IP**, définis et justifiés en un seul endroit :
`throttling.ts`. Un plafond de sécurité se relit en bloc — dispersé dans les contrôleurs,
on ne voit plus lequel manque.

| Périmètre                            | Plafond     | Décorateur        |
| ------------------------------------ | ----------- | ----------------- |
| Tous les endpoints                   | 120 req/min | (guard global)    |
| `POST /auth/login`, `/auth/register` | 5 req/min   | `@ThrottleAuth()` |
| `POST /routes/plan`                  | 20 req/min  | `@ThrottlePlan()` |

`ThrottlerGuard` est déclaré **avant** `JwtAuthGuard` dans `app.module.ts` : une rafale
anonyme est coupée sans payer la vérification de signature ni la moindre requête en base.
Le compteur est indexé sur l'IP et non sur l'e-mail visé — compter par e-mail ouvrirait
un déni de service ciblé sur le compte d'un tiers. Aucun compte n'est verrouillé : la
fenêtre expire d'elle-même au bout d'une minute.

Analyse complète, limites (stockage en mémoire, `TRUST_PROXY`) et checklist OWASP :
[`docs/securite-owasp.md`](../../../../docs/securite-owasp.md).

```bash
cd apps/api
npx jest src/common/throttling.spec.ts
```

## Autres briques

- `filters/global-exception.filter.ts` — normalise les réponses d'erreur, journalise sans
  données personnelles (C11).
- `enums/` — `TransportMode`, `RoutePriority` : vocabulaire métier partagé (F2/F3).

## Contraintes couvertes

C4 (authentification par défaut, signature/expiration vérifiées, identité non usurpable,
plafonds anti-brute-force), C11 (token lu depuis un cookie httpOnly), C5/C10 (les
plafonds évitent de relayer des rafales inutiles vers nos sources de données).
