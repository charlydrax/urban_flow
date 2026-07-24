# Module `auth` — Authentification (F1)

## Rôle

Inscription, connexion et émission des JWT vérifiés par le guard global de l'API Gateway
(flux de référence, étape 2 : JWT invalide/expiré → 401).

## Endpoints

| Méthode | Route                | Description                              | Statut                                |
| ------- | -------------------- | ---------------------------------------- | ------------------------------------- |
| POST    | `/api/auth/register` | Inscription (email + mot de passe fort)  | ✅ persistance + hash argon2 (UF-102) |
| POST    | `/api/auth/login`    | Connexion (vérifie email + mot de passe) | ✅ vérification argon2 + JWT (UF-103) |

Le token est posé en **cookie httpOnly** `access_token` (C11) et renvoyé dans le corps
(confort de dev/Swagger — à restreindre avant la production).

### Connexion (`/api/auth/login`, UF-103)

- Recherche du compte par email **normalisé** (trim + minuscules), puis vérification
  du mot de passe avec `argon2.verify`.
- **Identifiants invalides → `401` avec un message générique** (`Invalid credentials`) :
  email inconnu et mot de passe faux renvoient exactement la même réponse, sans révéler
  lequel est en cause (bonne pratique OWASP — C4).
- **Anti-énumération temporelle** : quand l'email n'existe pas, un hash argon2 factice est
  tout de même vérifié pour garder un temps de réponse constant.
- Le JWT émis contient le **`userId` réel** (`sub`) et une **expiration** (`JWT_EXPIRES_IN`).

## Dépendances

- `@nestjs/jwt` + `passport-jwt` (stratégie dans `src/common/strategies/jwt.strategy.ts`)
- `argon2` (hash à l'inscription, `verify` à la connexion)
- `PrismaService` (modèle `User`) — lecture/écriture des comptes

## Contraintes couvertes

C4 (validation DTO, politique de mot de passe, JWT signé/expirant), C8 (minimisation :
seul l'email est collecté), C11 (cookie httpOnly, SameSite).
