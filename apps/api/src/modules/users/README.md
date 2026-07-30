# Module `users` — Profil & préférences de mobilité (F1)

## Rôle

Gestion du **profil de compte** (identité minimale, consentement géolocalisation)
et des **préférences de mobilité** (modes acceptés, priorité rapide/écolo,
accessibilité PMR, marche maximale), lues par le Service Itinéraire à l'étape 3
du flux de référence puis appliquées au tri des options (F2).

## Endpoints (tous protégés par le guard JWT global)

| Méthode | Route           | Description                                        |
| ------- | --------------- | -------------------------------------------------- |
| GET     | `/api/users/me` | Profil du compte connecté (identité + préférences) |
| PATCH   | `/api/users/me` | Mise à jour **partielle** du profil                |

### `GET /api/users/me`

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "email": "marie@example.com",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "geolocationConsentAt": null,
  "preferences": {
    "preferredModes": ["WALK", "METRO", "BIKE"],
    "priority": "GREENEST",
    "reducedMobility": false,
    "maxWalkMinutes": 15
  }
}
```

Un compte qui n'a jamais enregistré ses préférences reçoit les **valeurs par
défaut** (`WALK`/`METRO`/`BIKE`, priorité `GREENEST`, 15 min de marche) sans
qu'aucune ligne ne soit créée en base : une lecture n'écrit jamais (C5). La ligne
`mobility_profiles` naît au premier `PATCH`.

### `PATCH /api/users/me`

Sémantique partielle : **tout champ absent reste inchangé**. Envoyer un seul
réglage est donc suffisant et attendu (C5, C10).

```json
{
  "geolocationConsent": true,
  "preferences": { "priority": "FASTEST", "maxWalkMinutes": 25 }
}
```

Réponses : `200` (profil relu en base), `400` (validation — clé inconnue, mode
hors catalogue, liste de modes vide, marche hors 0–60), `401` (session absente ou
expirée), `404` (compte supprimé alors que le token est encore valide).

## Isolation des profils (OWASP A01)

Aucune route n'accepte d'identifiant : `me` est le **seul** moyen de désigner un
profil, et le `userId` employé comme clé de toutes les requêtes Prisma vient du
JWT vérifié (`@CurrentUser`). Un `userId` glissé dans le corps est rejeté en
`400` par le `ValidationPipe` global (`forbidNonWhitelisted`). Le service
n'expose délibérément aucune méthode « lire le profil de X ».

## Dépendances

- `PrismaService` — modèles `User` et `MobilityProfile`
- `@CurrentUser()` — identité issue du JWT (jamais du corps — C4)
- `@urbanflow/shared` — contrats `UserProfile`, `MobilityPreferences`,
  `UpdateUserProfilePayload` partagés avec le front (C9)

## Contraintes couvertes

| Contrainte | Traduction dans le module                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| C4         | Validation stricte des DTO, identité issue du token, aucune route paramétrée par un identifiant       |
| C5 / C10   | `PATCH` partiel, lecture sans écriture, sélection Prisma limitée aux colonnes utiles                  |
| C8         | Minimisation (jamais d'historique ni de hash), consentement géolocalisation horodaté **et révocable** |
| C11        | `passwordHash` jamais sélectionné, donc jamais journalisé ni sérialisé                                |
| C12        | Préférence PMR transmise au planificateur pour les itinéraires accessibles                            |

## Tests

- `users.service.spec.ts` — persistance, défauts, partialité du `PATCH`,
  traçabilité du consentement, 404 sur compte supprimé.
- `users.controller.spec.ts` — parcours HTTP réel (guard + `ValidationPipe`) avec
  **deux comptes** en base simulée : chacun ne lit et n'écrit que son profil
  (recette 2 du ticket).

## Reste à faire (hors UF-107)

- Changement d'email et de mot de passe : nécessite une re-vérification de
  l'adresse et la réémission du JWT — hors périmètre de ce ticket.
- Suppression du compte (droit à l'effacement, C8) : la cascade est en place dans
  le schéma Prisma, l'endpoint reste à exposer.
- Consommation de `getPreferences()` par le planificateur (F2, étape 3 du flux).
