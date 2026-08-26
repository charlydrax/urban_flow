# Endpoint interne de test des sources (UF-306) — _retiré_

> 🗄️ **Archive.** `POST /api/routes/sources` **n'existe plus** : il a été
> supprimé par UF-402, avec l'écran `/dev/sources`, le
> `SourceDiagnosticsService`, ses DTO et la variable `ROUTES_SOURCES_DEBUG`.
> Cette page reste en place parce qu'elle documente une décision d'architecture
> du Sprint 3 — pourquoi vérifier les connecteurs avant d'écrire la fusion — et
> parce que la démarche est reproductible ; elle ne décrit plus le code courant.
>
> **Ce qui le remplace :** `POST /api/routes/plan` rend de vrais itinéraires
> depuis UF-401, et publie un champ `sources` qui dit quelle source a répondu.
> Ce que le diagnostic apportait en plus — la **cause technique réelle** de
> chaque panne — reste volontairement absent de l'API : il n'apprendrait rien à
> l'usager et exposerait notre topologie (C11). Il se lit dans les **logs du
> serveur**, où `SourceCollectorService` journalise chaque échec.
>
> **Pourquoi le supprimer plutôt que de le laisser fermé en production.** Il
> était déjà éteint hors développement (`404`), mais son code partait quand même
> dans le bundle de production : une route qui publie nos causes de panne y
> restait à un drapeau d'environnement près. Un accessoire de vérification qui a
> fait son office se retire, il ne se garde pas « au cas où » — c'est la
> recette 4 d'UF-402.
>
> **Le rejouer si besoin :** `git show 6c78520` (merge d'UF-306) contient le
> service, l'écran et leurs tests.

---

## 1. Pourquoi un endpoint séparé plutôt que d'attendre `/routes/plan`

À la fin du Sprint 3, trois connecteurs existent et sont orchestrés — GTFS via
OpenTripPlanner (UF-302), GBFS (UF-303), tronçons cyclables PostGIS (UF-304) —
mais rien ne les consomme réellement : `/routes/plan` rend encore des
itinéraires mockés.

Construire la fusion directement par-dessus reviendrait à empiler deux étages
non vérifiés. Une liste d'itinéraires vide ne dirait pas où est le tort :

| Symptôme               | Cause possible A         | Cause possible B           |
| ---------------------- | ------------------------ | -------------------------- |
| Aucun itinéraire rendu | la fusion a un bug       | une source est muette      |
| Trajet TC absent       | mapping GTFS incomplet   | contrainte PMR restrictive |
| Pas d'option vélo      | aucune borne à proximité | opérateur injoignable      |

L'endpoint tranche : il montre ce que **chaque source** a répondu, séparément,
avant toute transformation. C'est aussi le point de vérification visuelle
demandé par le ticket, et une pièce de démonstration en soutenance.

---

## 2. Contrat

### Requête

Deux façons de désigner le trajet à sonder, exclusives :

```jsonc
// a. saisie directe — les coordonnées sont obligatoires (le géocodage est fait par le client, UF-203)
{
  "from": { "label": "Gare Part-Dieu", "lat": 45.760515, "lng": 4.859057 },
  "to": { "label": "Bellecour", "lat": 45.757813, "lng": 4.832011 }
}

// b. rejeu d'une recherche enregistrée (UF-204)
{ "searchHistoryId": "2b1f0e6c-8a4a-4c2f-9a3e-1d6b7c8e9f01" }
```

Un corps qui ne porte ni l'un ni l'autre est un `400` explicite : la règle vit
dans la validation (`@ValidateIf`), pas dans le service, pour que le message
dise quoi envoyer plutôt que d'échouer plus loin (C4).

### Réponse

```jsonc
{
  "collectedAt": "2026-08-26T09:12:04.512Z",
  "elapsedMs": 1875,
  "allSourcesFailed": false,
  "query": {
    "from": { "label": "Gare Part-Dieu", "lat": 45.760515, "lng": 4.859057 },
    "to": { "label": "Bellecour", "lat": 45.757813, "lng": 4.832011 },
    "replayedSearchHistoryId": null,
  },
  "preferences": { "reducedMobility": false },
  "sources": {
    "transit": {
      "source": "transit",
      "status": "ok",
      "elapsedMs": 1840,
      "data": {
        /* TransitJourneysResult */
      },
    },
    "sharedMobility": {
      "source": "sharedMobility",
      "status": "failed",
      "elapsedMs": 5003,
      "failure": { "kind": "unavailable", "reason": "timeout" },
      "data": null,
    },
    "cyclePaths": {
      "source": "cyclePaths",
      "status": "ok",
      "elapsedMs": 47,
      "data": {
        /* deux extrémités */
      },
    },
  },
}
```

**Un objet par source, nommé** — et non un tableau fusionné : c'est la recette 3
du ticket. Une panne GBFS doit se lire explicitement, pas en creux dans
l'absence d'une ligne.

### Codes de retour

| Code  | Quand                                                                        |
| ----- | ---------------------------------------------------------------------------- |
| `200` | Collecte effectuée — **y compris** quand les trois sources ont échoué        |
| `400` | Ni `{ from, to }` complets, ni `searchHistoryId`, ou coordonnées hors bornes |
| `401` | JWT absent, invalide ou expiré (guard global — recette 2)                    |
| `404` | Endpoint désactivé, ou `searchHistoryId` absent de **votre** historique      |

Trois sources muettes restent un `200` avec `allSourcesFailed: true`, comme pour
`/routes/plan` : un `500` ferait croire à un défaut de la requête (C10).

---

## 3. Ce qu'il partage avec `/routes/plan`, et ce qu'il ne partage pas

```
POST /routes/plan            POST /routes/sources
        │                             │
        ├── UsersService.getPreferences (étape 3)      ← partagé
        ├── SourceCollectorService.collectAllSources   ← partagé
        │                             │
        ├── fusion + CO₂ (Sprint 4)   └── projection brute
        └── écriture search_history       (aucune écriture)
```

Le diagnostic **ne passe pas par `RoutesService.plan`**. S'il l'empruntait, il
mesurerait la fusion en plus des sources et ne pourrait plus dire laquelle des
deux étapes a échoué — ce qui est précisément sa raison d'être.

---

## 4. La réutilisation de l'historique (UF-204)

`searchHistoryId` rejoue une recherche déjà enregistrée. Ce n'est pas un
raccourci de confort : sonder « à peu près le même trajet » interroge d'autres
points, et un diagnostic qui ne reproduit pas le cas signalé ne prouve rien.

La lecture passe par `SearchHistoryService.findOwnedById(userId, id)`, où le
`user_id` fait partie de la clause `WHERE` — il n'est pas vérifié après coup :

```sql
WHERE id = $1::uuid AND user_id = $2::uuid
```

Un identifiant appartenant à quelqu'un d'autre ne remonte donc **aucune ligne**,
et l'appelant ne peut pas distinguer « n'existe pas » de « n'est pas à vous »
(C4 / OWASP A01). Sans cela, l'endpoint serait devenu un moyen de lire les
trajets d'autrui en les faisant rejouer.

### Il lit l'historique, il n'y écrit jamais

Sonder l'infrastructure n'est pas un déplacement. Inscrire ces appels parmi les
trajets de l'usager fausserait ses rappels récents et, à terme, son tableau de
bord carbone. Minimisation (C8) : on enregistre ce qui décrit l'usager, pas ce
qui décrit nos serveurs.

---

## 5. Pourquoi il est fermé en production

La réponse porte la **cause technique réelle** de chaque panne
(`failure.reason`), là où le champ `sources` de `/routes/plan` s'en tient à un
vocabulaire pauvre (`timeout`, `network`, `upstream-error`, `internal-error`)
pour ne rien dire de notre topologie (C11). Utile en développement,
indéfendable en production.

| `ROUTES_SOURCES_DEBUG` | `NODE_ENV`     | Endpoint   |
| ---------------------- | -------------- | ---------- |
| absente                | ≠ `production` | **ouvert** |
| absente                | `production`   | `404`      |
| `true`                 | n'importe      | **ouvert** |
| `false`                | n'importe      | `404`      |

Deux choix méritent d'être justifiés :

- **`404` et non `403`** : un refus confirmerait l'existence de la route. Une
  route inconnue n'apprend rien à qui la sonde.
- **Variable facultative, défaut fermé en production** : il ne faut rien
  configurer pour être en sécurité, et une ligne explicite pour ne pas l'être.
  L'inverse ferait qu'un `.env` incomplet ouvrirait la route.

La variable est validée comme une **chaîne** (`'true'` / `'false'`) et non comme
un booléen : `process.env` ne porte que du texte, et la conversion implicite de
`class-transformer` ferait de `"false"` un booléen vrai — une variable censée
fermer la route l'ouvrirait.

---

## 6. L'écran `/dev/sources`

Réutilise strictement les composants du design system (UF-007) : le ticket
demande explicitement de ne pas investir de temps de design ici, aucune maquette
Figma dédiée n'a donc été produite.

Ce qu'il montre :

1. **La durée totale, face à la source la plus lente** — c'est la preuve
   visuelle du parallélisme (C10). Si le total approchait la somme des trois
   durées, les appels seraient en cascade.
2. **Une carte par source** : état, durée, résumé lisible (nombre de trajets, de
   stations, de tronçons), et cause technique en cas de panne.
3. **Le JSON brut**, dans un `<details>` replié. Une collecte lyonnaise pèse
   plusieurs centaines de kilo-octets — surtout les tracés des tronçons
   cyclables. L'information reste accessible, mais on ne la paie qu'en la
   demandant (C5).
4. **Les recherches récentes**, recliquables pour rejouer un trajet (UF-204).

Accessibilité (C7) : le résultat arrive hors du flux de lecture, la zone est
donc une région `aria-live="polite"` ; chaque rappel de trajet est un bouton
avec un `aria-label` qui dit ce que le clic va faire.

---

## 7. Recette du ticket

### Recette 1 — « Un appel avec un départ/arrivée lyonnais retourne les données des 3 sources agrégées »

```bash
# 1. se connecter et garder le cookie httpOnly
curl -c cookies.txt -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"marie@example.com","password":"..."}'

# 2. sonder les trois sources
curl -b cookies.txt -X POST http://localhost:3001/api/routes/sources \
  -H 'Content-Type: application/json' \
  -d '{"from":{"label":"Gare Part-Dieu","lat":45.760515,"lng":4.859057},
       "to":{"label":"Bellecour","lat":45.757813,"lng":4.832011}}'
```

Attendu : un `200` dont `sources.transit`, `sources.sharedMobility` et
`sources.cyclePaths` portent chacun des données.

> ⚠️ Le GTFS TCL disponible est un instantané daté (voir
> [`otp-gtfs.md`](otp-gtfs.md)) : `serviceDate` peut différer de la date du jour,
> avec `dateAdjusted: true`. Ce n'est pas une panne.

### Recette 2 — « L'endpoint est protégé (401 sans token) »

```bash
curl -i -X POST http://localhost:3001/api/routes/sources \
  -H 'Content-Type: application/json' \
  -d '{"from":{"label":"A","lat":45.76,"lng":4.86},"to":{"label":"B","lat":45.75,"lng":4.83}}'
# → HTTP/1.1 401 Unauthorized
```

### Recette 3 — « Les données de chaque source sont identifiables séparément »

`sources` est un **objet à trois clés nommées**, pas un tableau. Chaque entrée
porte son `source`, son `status`, son `elapsedMs` et sa `data`. Couvert par
`source-diagnostics.service.spec.ts`.

### Vérification de la dégradation

Couper une source et relancer : les deux autres répondent toujours, et la
troisième affiche sa cause.

```bash
# OTP à l'arrêt → transit "failed", les deux autres "ok"
docker compose stop otp
```

### Vérification de la fermeture hors développement

> Sans objet depuis UF-402 : l'endpoint et sa variable `ROUTES_SOURCES_DEBUG`
> ont été retirés. `POST /api/routes/sources` répond désormais `404` sur **tous**
> les environnements, sans qu'aucune configuration ne puisse l'ouvrir.

À l'époque, dans `apps/api/.env` :

```bash
ROUTES_SOURCES_DEBUG=false
# → 404 sur POST /api/routes/sources, y compris avec un token valide
```

---

## 8. Exécuter les tests

```bash
cd apps/api && npx jest src/modules/routes
```

Sans réseau ni base : le collecteur et l'historique sont simulés. Ce qui est
vérifié ici est le diagnostic (séparation des sources, rejeu cloisonné, absence
d'écriture, fermeture de l'endpoint), pas la collecte — elle a sa propre suite,
décrite dans [`source-orchestration.md`](source-orchestration.md).

---

## 9. Contraintes couvertes

| Contrainte | Traduction dans le ticket                                                          |
| ---------- | ---------------------------------------------------------------------------------- |
| C4         | Validation stricte, identité du JWT, rejeu cloisonné, surface fermée en production |
| C5         | JSON brut derrière un dépli, aucune relecture inutile de l'historique              |
| C7         | Région `aria-live`, boutons libellés, contrastes du design system                  |
| C8         | Aucune écriture dans `search_history` — un diagnostic n'est pas un déplacement     |
| C9         | Contrat partagé `@urbanflow/shared`, dates ISO 8601, Swagger                       |
| C10        | Durées par source publiées : le parallélisme devient observable                    |
| C11        | Cause technique confinée au développement ; logs sans coordonnées ni libellés      |
| C12        | Préférence PMR lue sur le compte et publiée dans la réponse                        |

---

## 10. Ce que ce ticket ne fait volontairement pas

- **Aucune fusion** : construire un itinéraire multimodal à partir de ces
  données est l'objet du Sprint 4.
- **Aucun calcul de CO₂** : il n'y a pas encore de segments à mesurer.
- **Aucune écriture d'historique** : voir la section 4.
- **Aucun design dédié** : le ticket le demande explicitement.
