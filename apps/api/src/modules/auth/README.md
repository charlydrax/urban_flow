# Module `auth` — Authentification (F1)

## Rôle

Inscription, connexion et émission des JWT vérifiés par le guard global de l'API Gateway
(flux de référence, étape 2 : JWT invalide/expiré → 401).

## Endpoints

| Méthode | Route                | Description                             | Statut                                     |
| ------- | -------------------- | --------------------------------------- | ------------------------------------------ |
| POST    | `/api/auth/register` | Inscription (email + mot de passe fort) | stub (JWT réel signé, pas de persistance)  |
| POST    | `/api/auth/login`    | Connexion                               | stub (accepte tout identifiant bien formé) |

Le token est posé en **cookie httpOnly** `access_token` (C11) et renvoyé dans le corps
(confort de dev/Swagger — à restreindre avant la production).

## Dépendances

- `@nestjs/jwt` + `passport-jwt` (stratégie dans `src/common/strategies/jwt.strategy.ts`)
- `argon2` (hash des mots de passe — branché lors de l'implémentation F1)
- `PrismaService` (modèle `User`) — non utilisé tant que le module est en stub

## Contraintes couvertes

C4 (validation DTO, politique de mot de passe, JWT signé/expirant), C8 (minimisation :
seul l'email est collecté), C11 (cookie httpOnly, SameSite).
