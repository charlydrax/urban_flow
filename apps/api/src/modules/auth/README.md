# Module `auth` — Authentification (F1)

## Rôle

Inscription, connexion et émission des JWT vérifiés par le guard global de l'API Gateway
(flux de référence, étape 2 : JWT invalide/expiré → 401).

## Endpoints

| Méthode | Route                | Description                              | Statut                                |
| ------- | -------------------- | ---------------------------------------- | ------------------------------------- |
| POST    | `/api/auth/register` | Inscription (email + mot de passe fort)  | ✅ persistance + hash argon2 (UF-102) |
| POST    | `/api/auth/login`    | Connexion (vérifie email + mot de passe) | ✅ vérification argon2 + JWT (UF-103) |
| GET     | `/api/auth/me`       | Identité du compte connecté (protégée)   | ✅ sonde de session (UF-106)          |
| POST    | `/api/auth/logout`   | Purge le cookie de session               | ✅ UF-106                             |

Le token est posé en **cookie httpOnly** `access_token` (C11) et renvoyé dans le corps
(confort de dev/Swagger — à restreindre avant la production).

### Session (`/api/auth/me` et `/api/auth/logout`, UF-106)

- `GET /auth/me` est la **seule route protégée du module** : le guard global répond `401`
  si le cookie est absent, falsifié ou expiré. Le front s'en sert pour vérifier que sa
  session est toujours vivante — il ne peut pas lire le token lui-même (`httpOnly`, C11).
  À distinguer de `GET /users/me`, qui exposera le _profil applicatif_ lu en base :
  ici l'identité vient uniquement du **token vérifié** (anti-usurpation — C4).
- `POST /auth/logout` efface le cookie (`Set-Cookie` vide, mêmes attributs qu'à la pose).
  C'est **indispensable côté serveur** : un cookie `httpOnly` est hors d'atteinte du
  JavaScript, le front ne peut donc pas se déconnecter seul.
  Volontairement `@Public()` et **idempotent** : purger une session déjà expirée doit
  réussir, sinon le cas « 401 → purge → retour connexion » boucle sur lui-même.

### Connexion (`/api/auth/login`, UF-103)

- Recherche du compte par email **normalisé** (trim + minuscules), puis vérification
  du mot de passe avec `argon2.verify`.
- **Identifiants invalides → `401` avec un message générique** (`Invalid credentials`) :
  email inconnu et mot de passe faux renvoient exactement la même réponse, sans révéler
  lequel est en cause (bonne pratique OWASP — C4).
- **Anti-énumération temporelle** : quand l'email n'existe pas, un hash argon2 factice est
  tout de même vérifié pour garder un temps de réponse constant.
- Le JWT émis contient le **`userId` réel** (`sub`) et une **expiration** (`JWT_EXPIRES_IN`).

## Les trois régimes du guard JWT global

Le guard s'applique à **toute** l'API ; ce qui varie, c'est ce qu'il exige.

| Régime            | Sans jeton           | Jeton invalide | Jeton valide      | Où                                      |
| ----------------- | -------------------- | -------------- | ----------------- | --------------------------------------- |
| défaut            | `401`                | `401`          | identité exposée  | partout ailleurs                        |
| `@OptionalAuth()` | passe, sans identité | `401`          | identité exposée  | `POST /routes/plan` (UF-801)            |
| `@Public()`       | passe                | passe          | **sans identité** | `login`, `register`, `logout`, `health` |

La dernière colonne de `@Public()` est le piège d'UF-801 : la stratégie Passport
n'y est jamais jouée, donc un utilisateur connecté arrive **anonyme**. C'est
sans conséquence sur `login` ou `health`, qui n'ont que faire d'une identité ;
ça l'aurait été sur le planificateur, dont le résultat dépend du profil.

L'extraction du jeton (cookie httpOnly d'abord, en-tête `Bearer` ensuite) est
définie une seule fois, dans `src/common/access-token.ts`, et sert à la fois à
la stratégie et au guard — deux lectures divergentes du même en-tête finiraient
par ne plus s'accorder sur qui a le droit d'entrer.

## Authentifier n'est pas autoriser (UF-701)

Le guard JWT répond à « **qui** est-ce ? ». Depuis UF-701, une seconde question
peut suivre — « **a-t-il le droit ?** » — et c'est le `RolesGuard`
(`src/common/guards/roles.guard.ts`) qui y répond, déclaré juste après dans
`AppModule`. L'ordre produit les deux codes attendus : `401` quand
l'authentification manque, `403` quand c'est l'autorisation.

Le jeton porte désormais une revendication `role`, et il faut être précis sur
ce qu'elle fait :

| Qui la lit             | Ce qu'il en fait                                     |
| ---------------------- | ---------------------------------------------------- |
| La PWA (`readSession`) | décide s'il faut **peindre** le bouton de simulation |
| Le `RolesGuard`        | **rien** — il relit le rôle en base à chaque appel   |

C'est délibéré. Un jeton vit quinze minutes : accorder un accès sur une
revendication vieille de quinze minutes serait accorder un accès qu'on ne peut
pas révoquer (OWASP A01). Le rôle en base est la seule source de vérité en
matière d'autorisation ; celui du jeton n'est qu'un raccourci d'affichage, qui
ne peut au pire que faire apparaître un bouton dont l'action sera refusée.

Une seule règle à retenir en relisant ce code : **le repli est toujours le
moins-disant**. Jeton sans `role` (émis avant UF-701), valeur inconnue, valeur
fabriquée à la main dans le cookie — tout retombe sur `user`.

L'inscription, elle, n'accepte aucun rôle : `RegisterDto` n'a pas de champ, et
le `ValidationPipe` global (`forbidNonWhitelisted`) refuse en `400` une requête
qui en enverrait un. Un compte `admin` se crée par le seed
(`DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`) ou en base, jamais par le formulaire.

## Dépendances

- `@nestjs/jwt` + `passport-jwt` (stratégie dans `src/common/strategies/jwt.strategy.ts`)
- `argon2` (hash à l'inscription, `verify` à la connexion)
- `PrismaService` (modèle `User`) — lecture/écriture des comptes

## Contraintes couvertes

C4 (validation DTO, politique de mot de passe, JWT signé/expirant, autorisation
décidée en base et non sur une revendication — UF-701), C8 (minimisation :
seuls l'email et le rôle sont exposés), C11 (cookie httpOnly, SameSite).
