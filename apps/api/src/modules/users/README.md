# Module `users` — Profil, préférences de mobilité et droits RGPD (F1)

## Rôle

Gestion du **profil de compte** (identité minimale, consentement géolocalisation)
et des **préférences de mobilité** (modes acceptés, priorité rapide/écolo,
accessibilité PMR, marche maximale), lues par le Service Itinéraire à l'étape 3
du flux de référence puis appliquées au tri des options (F2).

Depuis UF-603, le module porte aussi le **droit à l'effacement** (art. 17 RGPD) :
consulter, rectifier et supprimer ses données se font au même endroit — voir
[`docs/rgpd.md`](../../../../docs/rgpd.md).

## Endpoints (tous protégés par le guard JWT global)

| Méthode | Route           | Description                                                |
| ------- | --------------- | ---------------------------------------------------------- |
| GET     | `/api/users/me` | Profil du compte connecté (identité + préférences)         |
| PATCH   | `/api/users/me` | Mise à jour **partielle** du profil                        |
| DELETE  | `/api/users/me` | Efface le compte et toutes ses données (RGPD art. 17 — C8) |

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
    "maxWalkMinutes": 15,
    "monthlyCarbonGoalGrams": null
  }
}
```

Un compte qui n'a jamais enregistré ses préférences reçoit les **valeurs par
défaut** (`WALK`/`METRO`/`BIKE`, priorité `GREENEST`, 15 min de marche) sans
qu'aucune ligne ne soit créée en base : une lecture n'écrit jamais (C5). La ligne
`mobility_profiles` naît au premier `PATCH`.

### `monthlyCarbonGoalGrams` — le budget carbone (UF-805)

Le budget mensuel de la page « Mon impact », en **grammes** comme tout le domaine
carbone. Rangé ici et non dans un module « objectifs » : c'est un réglage du
compte, il se modifie par le même `PATCH` que les autres et disparaît avec le
profil (C8).

Trois états, et le troisième est celui qu'on oublie :

| Valeur envoyée | Effet                               |
| -------------- | ----------------------------------- |
| champ absent   | l'objectif reste **inchangé**       |
| un entier      | l'objectif est **fixé** ou remplacé |
| `null`         | l'objectif est **retiré**           |

Sans le troisième cas, un objectif une fois posé ne serait plus retirable
autrement qu'en le portant très haut — or « je ne me fixe plus de budget » n'est
pas « mon budget est très grand ». C'est aussi pourquoi la valeur par défaut est
`null` et non `0` : un objectif à zéro afficherait un dépassement perpétuel à
tout compte neuf.

Bornes : 1 kg à 1 t par mois. Volontairement larges — elles refusent une valeur
absurde venue du réseau (C4), elles n'arbitrent pas ce qu'un usager a le droit de
viser. C'est `GET /api/carbon/summary` qui proratise ce budget à la période
affichée, pas ce module.

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

### `DELETE /api/users/me`

Aucun corps, aucun paramètre : le compte effacé est celui du token vérifié.

```json
{
  "deletedUserId": "11111111-1111-4111-8111-111111111111",
  "deletedSearchHistoryCount": 42,
  "deletedMobilityProfile": true,
  "deletedAt": "2026-08-29T10:12:00.000Z"
}
```

L'effacement est **réel, pas logique** : pas de `deletedAt` en base, pas de ligne
anonymisée conservée. Une seule suppression suffit, les cascades du schéma Prisma
emportent `mobility_profiles` et `search_history`. Les décomptes sont relevés
**avant** le `DELETE`, dans la même transaction — après, il n'y aurait plus rien à
compter, et hors transaction une écriture concurrente fausserait le total.

Le cookie de session est purgé dans la foulée (attributs partagés avec la pose —
`common/auth-cookie.ts`, sinon le navigateur ne cible pas le bon cookie). Le JWT
déjà émis reste cryptographiquement valide jusqu'à expiration, mais il ne désigne
plus rien : toute route protégée répond désormais `404`.

Réponses : `200` (preuve d'exécution ci-dessus), `401` (session absente),
`404` (compte déjà supprimé).

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

| Contrainte | Traduction dans le module                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| C4         | Validation stricte des DTO, identité issue du token, aucune route paramétrée par un identifiant                                           |
| C5 / C10   | `PATCH` partiel, lecture sans écriture, sélection Prisma limitée aux colonnes utiles                                                      |
| C8         | Minimisation (jamais d'historique ni de hash), consentement géolocalisation horodaté **et révocable**, droit à l'effacement (`DELETE me`) |
| C11        | `passwordHash` jamais sélectionné, donc jamais journalisé ni sérialisé                                                                    |
| C12        | Préférence PMR transmise au planificateur pour les itinéraires accessibles                                                                |

## Tests

- `users.service.spec.ts` — persistance, défauts, partialité du `PATCH`,
  traçabilité du consentement, 404 sur compte supprimé.
- `users.controller.spec.ts` — parcours HTTP réel (guard + `ValidationPipe`) avec
  **deux comptes** en base simulée : chacun ne lit et n'écrit que son profil
  (recette 2 du ticket). L'entrepôt simule aussi la **cascade** du schéma, sans
  quoi le test d'effacement dirait « la ligne `users` a disparu » et laisserait
  passer la fuite qu'on cherche justement à exclure.

## Reste à faire

- Changement d'email et de mot de passe : nécessite une re-vérification de
  l'adresse et la réémission du JWT — hors périmètre.
- Export des données personnelles (art. 20, portabilité) : la lecture est possible
  via `GET me` et `GET /api/search-history`, mais aucun fichier téléchargeable
  n'est proposé (cf. `docs/rgpd.md` §6).
