# Module `users` — Profils & préférences de mobilité (F1)

## Rôle

Gestion du profil de compte et des **préférences de mobilité** (modes favoris,
accessibilité PMR, marche maximale) lues par le Service Itinéraire à l'étape 3
du flux de référence.

## Endpoints (tous protégés par le guard JWT global)

| Méthode | Route                            | Description                 | Statut             |
| ------- | -------------------------------- | --------------------------- | ------------------ |
| GET     | `/api/users/me`                  | Profil du compte connecté   | stub               |
| GET     | `/api/users/me/mobility-profile` | Préférences de mobilité     | stub               |
| PUT     | `/api/users/me/mobility-profile` | Mise à jour des préférences | stub (écho validé) |

## Dépendances

- `PrismaService` (modèles `User`, `MobilityProfile`) — branché lors de l'implémentation F1
- Identité fournie par le JWT via `@CurrentUser()` (jamais par le corps — C4)

## Contraintes couvertes

C4 (validation DTO, identité issue du token), C8 (minimisation, droit à l'effacement à
implémenter avec la suppression en cascade), C12 (préférence PMR transmise au planificateur).
