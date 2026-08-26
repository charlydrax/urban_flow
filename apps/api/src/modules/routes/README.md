# Module `routes` — Planificateur multimodal (F2)

## Rôle

« Service Itinéraire » de l'architecture logique : calcule les itinéraires multimodaux
(TC + mobilités douces), orchestré selon le diagramme de séquence du MVP
(CLAUDE.md section 4).

## Endpoints (protégés par le guard JWT global)

| Méthode | Route                 | Description                                                   | Statut                                       |
| ------- | --------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| POST    | `/api/routes/plan`    | Itinéraires multimodaux + CO₂, triés par empreinte croissante | collecte réelle (UF-305), itinéraires mockés |
| POST    | `/api/routes/sources` | **[dev]** Données brutes des trois sources, sans fusion       | UF-306 — temporaire, fermé en production     |

Contrat d'entrée : `{ from: {label, lat, lng}, to: {...}, userId }` — `userId` est
supplanté par l'identité du JWT (anti-IDOR, C4).

⚠️ Les **coordonnées sont obligatoires** depuis UF-305 : les trois sources
travaillent sur des points, et le géocodage est fait par le client (UF-203). Un
label seul donne un `400` explicite — pas une liste vide inexplicable.

## Où en est le flux

| Étape                                           | Ticket   | État |
| ----------------------------------------------- | -------- | ---- |
| 3. Lecture des préférences profil (PostGIS)     | UF-107   | ✅   |
| 13-18. Collecte **parallèle** des trois sources | UF-305   | ✅   |
| Fusion en itinéraires multimodaux (404 si vide) | Sprint 4 | ⏳   |
| `computeFootprint` par itinéraire               | Sprint 4 | ⏳   |
| Sauvegarde `search_history`                     | Sprint 4 | ⏳   |
| Tri par CO₂ croissant                           | —        | ✅   |

Les itinéraires rendus restent donc les **mocks** du scénario nominal jusqu'à la
fusion. Le champ `sources` de la réponse est, lui, bien réel.

## Orchestration parallèle des sources (UF-305)

`SourceCollectorService.collectAllSources(from, to, prefs)` interroge les trois
sources en même temps et rapporte ce que chacune a dit — sans rien fusionner.

```
routes/
├── routes.service.ts            étapes 3 et 13-18, tri, garde-fous d'entrée
└── sources/
    ├── source-collector.service.ts   Promise.allSettled, budget, journalisation
    └── collected-sources.ts          contrats internes de la collecte
```

Détail complet et recette :
[`docs/source-orchestration.md`](../../../../../docs/source-orchestration.md).

### `allSettled`, et le piège qu'il ne suffit pas à éviter

`Promise.all` rejette au premier échec **et abandonne les autres résultats** :
une panne GBFS ferait perdre les trajets métro déjà calculés.
`Promise.allSettled` attend les trois quoi qu'il arrive.

Mais `TransitService` et `SharedMobilityService` **ne lèvent jamais** — ils
rendent `status: 'unavailable'`. Pour `allSettled`, ces appels sont donc
`fulfilled`, c'est-à-dire réussis. Une orchestration qui ne regarderait que
`settled.status` conclurait que tout va bien alors qu'aucune source n'a rien
fourni.

Une source est en échec dans **trois** cas, pas un :

| `kind`        | Ce qui s'est passé                                              |
| ------------- | --------------------------------------------------------------- |
| `unavailable` | la source a répondu qu'elle ne pouvait pas servir               |
| `error`       | la source a **levé** (bug, base HS) — rattrapé par `allSettled` |
| `timeout`     | rien rendu dans le budget de la collecte                        |

En revanche `journeys: []` avec `status: 'ok'` n'est **pas** un échec : c'est
« le moteur a cherché et n'a rien trouvé ». Le confondre afficherait
« transports en commun indisponibles » à qui habite hors du réseau.

### Le budget de collecte

Deux sources sur trois bornent leur propre attente ; **PostGIS n'a aucun délai**.
Le collecteur accorde donc `OTP_TIMEOUT_MS + 2 s` à chaque source.

Le dériver du délai d'OTP plutôt que de le fixer en dur évite qu'il ne préempte
le timeout d'OpenTripPlanner — la source serait coupée avant d'avoir pu qualifier
sa panne, et le diagnostic serait perdu pour rien. Ce n'est pas un second timeout
empilé : c'est un filet pour la seule source qui n'en a pas.

### Les deux extrémités du trajet

Un vélo partagé se prend à une borne **et** se rend à une autre. Les sources
géolocalisées sont donc interrogées aux deux extrémités, mais à l'intérieur d'une
même branche et en parallèle : **trois sources, cinq appels, une seule latence**
(C5/C10).

### Ce que le client voit

La réponse porte un champ `sources`, toujours présent :

```jsonc
"sources": [
  { "source": "transit", "available": true },
  { "source": "sharedMobility", "available": false, "reason": "network" },
  { "source": "cyclePaths", "available": true },
]
```

Sans lui, une liste sans option vélo est ambiguë — « aucun vélo praticable ici »
ou « l'opérateur n'a pas répondu » ? Ce n'est pas la même chose à annoncer à
l'usager, et c'est ce qui alimente le bandeau « mode dégradé » (C10).

La cause publiée reste générique : le détail technique n'apprendrait rien à
l'usager et exposerait notre topologie (C11).

**Trois sources muettes donnent un `200`** avec une liste vide, jamais un `500` :
un code d'erreur ferait croire que la requête de l'usager est fautive.

### Où s'arrête la dégradation gracieuse

Elle commence à la collecte. La lecture des préférences (étape 3) la précède et
n'est **pas** dégradée : sans profil, on ignore quels itinéraires l'usager
accepte et s'il lui faut des trajets praticables en fauteuil (C12). En inventer
serait pire que d'échouer.

Elle ne peut pas non plus être parallélisée avec la collecte : la préférence PMR
change la requête envoyée à OTP. Les lancer ensemble reviendrait à interroger le
moteur avant de savoir quoi lui demander.

> `GET /api/transport/cycle-paths/nearby` (UF-304) ne dégrade pas cette même
> source et remonte un `500`. Ce n'est pas une incohérence : là, l'usager demande
> les pistes cyclables, et une liste vide affirmerait qu'il n'y en a pas. Ici il
> demande des itinéraires — perdre une option vaut mieux que tout perdre.

## Endpoint interne de test des sources (UF-306)

`POST /api/routes/sources` déclenche la même collecte que `/routes/plan` et rend
les données **brutes** de chaque source, séparément — sans fusion, sans CO₂,
sans écriture d'historique.

```
routes/
└── sources/
    └── source-diagnostics.service.ts   résolution du trajet, projection, garde d'environnement
```

Il existe parce qu'une liste d'itinéraires vide ne dit pas où est le tort : la
fusion, ou une source muette ? Le vérifier **avant** d'écrire la fusion évite
d'empiler deux étages non validés.

Le corps accepte `{ from, to }` ou `{ searchHistoryId }` pour rejouer une
recherche enregistrée (UF-204) — relue avec l'identité du JWT, un identifiant
d'autrui donnant un `404` indiscernable d'un identifiant inexistant (C4).

**Il ne passe pas par `RoutesService.plan`** : l'emprunter mesurerait la fusion
en plus des sources, et il ne saurait plus dire laquelle des deux a échoué. Les
deux services partagent `UsersService` et `SourceCollectorService`, rien de plus.

**Il est fermé hors développement** (`404`), parce qu'il publie la cause
technique réelle de chaque panne — là où `sources` de `/routes/plan` s'en tient
à un vocabulaire générique (C11). `ROUTES_SOURCES_DEBUG=true|false` force le
comportement ; sans la variable, `NODE_ENV` décide.

Écran associé : `/dev/sources` (apps/web). Détail complet et recette :
[`docs/source-diagnostics-endpoint.md`](../../../../../docs/source-diagnostics-endpoint.md).

## Dépendances

- `TransportModule` — les **trois** sources : `TransitService` (GTFS, UF-302),
  `SharedMobilityService` (GBFS, UF-303) et `CyclePathsService`
  (`ST_DWithin` sur PostGIS, UF-304)
- `UsersModule` (préférences, étape 3), `CarbonModule` (CO₂, Sprint 4)
- `SearchHistoryModule` — **lecture seule** (UF-306) : rejouer une recherche
  enregistrée. Le planificateur y écrira au Sprint 4 ; le diagnostic, jamais (C8)
- `SourceCollectorService` — interne au module, volontairement **non exporté** :
  l'orchestration est une étape du planificateur, pas un service que d'autres
  modules auraient à consommer. L'exporter laisserait court-circuiter la lecture
  des préférences qui la précède.

## Tests

```bash
cd apps/api && npx jest src/modules/routes
```

Trois suites, sans réseau ni base. Les horloges ne sont **pas** simulées : les
faux minuteurs de Jest masqueraient exactement ce qu'on veut mesurer, à savoir
que les trois promesses progressent réellement en même temps.

## Contraintes couvertes

C4 (validation, anti-IDOR, coordonnées exigées, surface de diagnostic fermée en
production), C8 (le diagnostic n'écrit pas dans l'historique), C9 (GeoJSON
LineString, contrats partagés), C10 (appels parallèles, budget borné,
dégradation gracieuse, durées mesurées), C11 (logs sans donnée de déplacement,
cause publiée générique hors diagnostic), C12 (préférence PMR propagée au moteur
de routage).
