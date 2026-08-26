# Orchestration parallèle des sources (UF-305)

Comment le Service Itinéraire interroge ses trois sources, et ce qui se passe
quand l'une d'elles ne répond pas. Étapes 13-18 du flux de référence, plus le cas
d'erreur « une API externe indisponible → dégradation gracieuse » du diagramme de
séquence.

C'est la traduction directe de la contrainte **C10** (performance en mobilité) :
un usager sur un réseau mobile ne doit ni attendre trois latences bout à bout, ni
perdre toutes ses options parce qu'un opérateur a hoqueté.

Complète [`otp-gtfs.md`](./otp-gtfs.md), [`gbfs-velov.md`](./gbfs-velov.md) et
[`cycle-paths-postgis.md`](./cycle-paths-postgis.md), qui décrivent chacune des
trois sources prises isolément.

> Pour **observer** cette collecte sur un trajet réel — durées par source,
> données brutes, causes de panne —, voir
> [`source-diagnostics-endpoint.md`](./source-diagnostics-endpoint.md) (UF-306)
> et l'écran `/dev/sources`.

---

## 1. Le problème

Le planificateur a besoin de trois choses pour construire un itinéraire
multimodal :

| Source           | Ce qu'elle apporte                 | D'où elle vient          | Délai propre      |
| ---------------- | ---------------------------------- | ------------------------ | ----------------- |
| `transit`        | trajets en transports en commun    | OpenTripPlanner (UF-302) | `OTP_TIMEOUT_MS`  |
| `sharedMobility` | stations de vélos en libre-service | flux GBFS (UF-303)       | `GBFS_TIMEOUT_MS` |
| `cyclePaths`     | tronçons cyclables et piétons      | notre PostGIS (UF-304)   | **aucun**         |

Enchaînées, elles additionneraient leurs latences. En développement, OTP répond
entre 1,7 s et 8,3 s ; GBFS quelques centaines de millisecondes ; PostGIS
quelques millisecondes. En série, l'usager attendrait la somme. En parallèle, il
attend la plus lente — c'est-à-dire OTP, et rien de plus.

## 2. `Promise.allSettled`, et pourquoi pas `Promise.all`

Le flux de référence (CLAUDE.md §4) parle de `Promise.all`. C'est
`Promise.allSettled` qui est utilisé, et c'est délibéré.

`Promise.all` rejette **dès le premier échec** et abandonne les résultats des
autres promesses, même déjà résolues. Concrètement : l'opérateur de vélos ne
répond pas, et l'usager perd aussi ses trajets en métro qui étaient pourtant
calculés. C'est l'inverse exact de la dégradation gracieuse attendue.

`Promise.allSettled` attend les trois quoi qu'il arrive et rend un verdict par
source. On trie ensuite.

## 3. Le piège : `allSettled` ne suffit pas

C'est le point le moins évident de ce ticket, et celui qui mérite d'être dit en
soutenance.

`TransitService` et `SharedMobilityService` ont un **contrat de résilience** :
ils ne lèvent jamais à cause de leur source. Un timeout OTP, un flux GBFS retiré,
un HTTP 500 amont — tout cela devient un résultat `status: 'unavailable'`, rendu
normalement.

Du point de vue de `Promise.allSettled`, ces appels sont donc **`fulfilled`**,
c'est-à-dire réussis. Une orchestration qui ne regarderait que `settled.status`
conclurait que les trois sources vont bien, alors qu'aucune n'a rien fourni.

Une source est ici en échec dans **trois** cas :

| `kind`        | Ce qui s'est passé                                       | Qui le produit                            |
| ------------- | -------------------------------------------------------- | ----------------------------------------- |
| `unavailable` | la source a répondu qu'elle ne pouvait pas servir        | `TransitService`, `SharedMobilityService` |
| `error`       | la source a **levé** — bug, géométrie corrompue, base HS | rattrapé par `allSettled`                 |
| `timeout`     | la source n'a rien rendu dans le budget de la collecte   | le collecteur lui-même                    |

Un test fige chacun des trois (`source-collector.service.spec.ts`).

### Ce qui n'est _pas_ un échec

`journeys: []` avec `status: 'ok'` veut dire « le moteur a cherché et n'a rien
trouvé ». C'est une réponse, pas une panne. La compter comme un échec ferait
afficher « transports en commun indisponibles » à un usager qui habite
simplement hors du réseau — un message faux, et décourageant.

## 4. Le budget de collecte

Deux des trois sources bornent leur propre attente. La troisième, PostGIS, n'a
aucun délai : une requête bloquée sur un verrou immobiliserait la requête de
l'usager indéfiniment.

Le collecteur accorde donc à chaque source un budget, calculé ainsi :

```
budget = OTP_TIMEOUT_MS + 2000 ms
```

Le dériver du délai d'OTP plutôt que de le fixer en dur n'est pas cosmétique :
un budget inférieur préempterait le timeout d'OpenTripPlanner, qui serait coupé
**avant** d'avoir pu qualifier sa panne (`timeout` / `network` /
`upstream-error`). On perdrait le diagnostic pour rien.

Le budget n'est donc pas un second timeout empilé sur les premiers : c'est un
filet pour la seule source qui n'en a pas.

## 5. Ce que la collecte rend

`collectAllSources(from, to, prefs)` rend des **données brutes**, prêtes pour la
fusion du Sprint 4. Aucun tri, aucune fusion, aucun calcul carbone — la
construction des itinéraires est une autre étape, qui échoue pour d'autres
raisons, et les mêler rendrait les deux plus difficiles à tester.

```ts
interface CollectedSources {
  transit: SourceOutcome<TransitJourneysResult>;
  sharedMobility: SourceOutcome<SharedMobilityEndpoints>;
  cyclePaths: SourceOutcome<CyclePathEndpoints>;
  failures: SourceFailure[];
  allSourcesFailed: boolean;
  elapsedMs: number;
}
```

`elapsedMs` figure par source **et** au total. Ce n'est pas de la décoration :
c'est la preuve du parallélisme (recettes 1 et 4). Si le total ressemble à la
plus lente, les appels sont concurrents ; s'il ressemble à leur somme, ils sont
en cascade.

### Les deux extrémités du trajet

Un vélo partagé se prend à une borne **et** se rend à une autre. Les sources
géolocalisées sont donc interrogées aux deux extrémités — mais à l'intérieur
d'une seule branche, en parallèle elles aussi. Il y a bien **trois sources** et
cinq appels, pour une seule latence.

### Pourquoi ces types ne sont pas dans `@urbanflow/shared`

`@urbanflow/shared` porte les contrats front/back. `CollectedSources` est un
produit intermédiaire interne, que le client ne verra jamais. Le publier figerait
un détail d'implémentation dans le contrat public et gênerait la fusion à venir.

Seul `SourceAvailability` franchit la frontière, parce que le client en a
réellement besoin — voir plus bas.

## 6. Ce que le client voit

`POST /api/routes/plan` porte désormais un champ `sources` :

```jsonc
{
  "itineraries": [
    /* … */
  ],
  "sortedBy": "carbonAsc",
  "sources": [
    { "source": "transit", "available": true },
    { "source": "sharedMobility", "available": false, "reason": "network" },
    { "source": "cyclePaths", "available": true },
  ],
}
```

Il est **toujours présent**, même quand tout va bien : trois sources
`available` disent que la liste est complète, ce que le client ne peut pas
déduire d'un tableau d'itinéraires.

Sans ce champ, une liste sans option vélo est ambiguë — « aucun vélo praticable
ici » ou « l'opérateur n'a pas répondu » ? Ce n'est pas la même chose à annoncer
à l'usager, et c'est ce qui alimente le bandeau « mode dégradé ».

La cause publiée est volontairement générique (`timeout`, `network`,
`upstream-error`, `internal-error`). Le détail technique reste dans les logs du
serveur : il n'apprendrait rien à l'usager et exposerait notre topologie (C11).
Un test vérifie qu'un message d'erreur SQL ne franchit jamais la frontière HTTP.

### Trois sources muettes ne sont pas une erreur HTTP

Si tout échoue, la réponse reste `200` avec `itineraries: []` et trois sources
`available: false`. Un `500` ferait croire à l'usager que **sa** requête est
fautive, alors que ce sont nos sources qui manquent (recette 3).

En revanche, une extrémité **sans coordonnées** donne un `400` : le géocodage est
fait par le client (UF-203), un label seul est un défaut d'appel. Une liste vide
serait ininterprétable.

## 7. Où s'arrête la dégradation gracieuse

Elle commence à la collecte, pas avant.

La lecture des préférences du compte (étape 3 du flux) précède les trois appels
et n'est **pas** dégradée : sans profil, on ne sait pas quels itinéraires
l'usager accepte, ni s'il lui faut des trajets praticables en fauteuil (C12). En
inventer serait pire que d'échouer.

Cette lecture ne peut pas non plus être parallélisée avec la collecte : la
préférence PMR change la requête envoyée à OpenTripPlanner. Les lancer ensemble
reviendrait à interroger le moteur avant de savoir quoi lui demander.

### Une note sur `cyclePaths`

L'endpoint `GET /api/transport/cycle-paths/nearby` (UF-304) **ne** dégrade pas
cette source : il remonte un `500`. Ici, le planificateur la dégrade comme les
deux autres. Ce n'est pas une incohérence — c'est la question posée qui change.

Un client qui demande « les pistes cyclables autour de moi » et reçoit une liste
vide conclurait qu'il n'y en a pas : la réponse serait fausse. Un client qui
demande « des itinéraires » et reçoit le métro sans l'option vélo a perdu une
option, pas la vérité.

## 8. Journalisation (C11)

Chaque recherche produit une ligne, y compris quand tout va bien. Relevé réel,
sur une instance dont OTP et GBFS pointaient vers un hôte inexistant :

```
LOG  [SourceCollectorService] Collecte des sources en 154 ms (transit 55 ms,
     sharedMobility 10 ms, cyclePaths 106 ms ; la plus lente : 106 ms) — 1/3 source(s) disponible(s).
WARN [SourceCollectorService] Source transit indisponible (unavailable) : network
WARN [SourceCollectorService] Source sharedMobility indisponible (unavailable) : network / network
```

Trois choses s'y lisent d'un coup d'œil : le total suit la source la plus lente,
deux sources sur trois sont tombées, et la recherche a quand même abouti.

Deux choix à noter :

- Une panne **déclarée** part en `warn`, une **exception** en `error`. La
  première est attendue et se gère ; la seconde n'était prévue par personne et
  mérite d'être vue comme telle en supervision.
- **Aucune coordonnée, aucun libellé de lieu** n'est journalisé. Une cause de
  panne n'a pas besoin de savoir où allait l'usager — une ligne de log ne doit
  pas raconter un déplacement (C11). Un test le vérifie explicitement.

## 9. Recette du ticket

### Recette 1 — « Les 3 sources sont appelées en parallèle »

- [x] Les trois appels partent **avant le premier `await`** — c'est ce qui les
      rend concurrents. Un test le prouve directement : au moment où la source la
      plus rapide se termine, les deux autres ont déjà été appelées.
- [x] Trois sources à 150 ms chacune donnent une collecte de ~150 ms, pas 450 ms.
- [x] Visible en production dans les logs, qui portent la durée de chaque source.
- [x] Mesuré de bout en bout sur l'environnement de développement : `plan` répond
      en 1,73 s, quand GBFS seul répond en 8 ms et PostGIS en 20 ms. Le temps de
      la requête est celui d'OpenTripPlanner, et de lui seul.

### Recette 2 — « Si une source échoue, les autres sont bien retournées »

- [x] Une source qui **lève** : les deux autres sont conservées, la fautive passe
      en `failed` avec `kind: 'error'`.
- [x] Une source qui **déclare** son indisponibilité : même traitement, avec
      `kind: 'unavailable'` — c'est le cas que `allSettled` seul aurait manqué.
- [x] Une seule extrémité GBFS en panne ne condamne pas la source : des stations
      connues au départ permettent déjà un rabattement.

### Recette 3 — « Si toutes échouent, un état clair est remonté »

- [x] `allSourcesFailed: true`, `failures` détaillé, `data: null` partout —
      **aucune exception**. Vérifié y compris avec un rejet qui n'est pas une
      `Error` (une chaîne nue).
- [x] Le planificateur répond `200` avec une liste vide et trois sources
      `available: false`, jamais un `500`.
- [x] Couvert par les tests unitaires plutôt qu'en manuel, pour la raison
      expliquée plus haut : couper PostGIS arrête la requête avant la collecte.

### Recette 4 — « Le temps total ≈ la source la plus lente »

- [x] Avec des sources à 200 / 40 / 20 ms, le total suit la plus lente et le
      surcoût de l'orchestration reste sous 100 ms.
- [x] Le budget garantit ce comportement même face à une source sans délai propre
      (PostGIS bloqué) : elle est abandonnée, les deux autres reviennent.

### Vérification manuelle de la dégradation

Couper une source revient à pointer sa configuration vers un hôte qui n'existe
pas, puis à démarrer une instance sur un autre port :

```bash
cd apps/api && npm run build
PORT=3002 \
OTP_BASE_URL=http://127.0.0.1:9 OTP_TIMEOUT_MS=2000 \
GBFS_DISCOVERY_URL=http://127.0.0.1:9/gbfs.json GBFS_TIMEOUT_MS=1500 \
node dist/main.js
```

`POST /api/routes/plan` sur cette instance répond bien `200` en 0,28 s, avec les
itinéraires conservés et les deux sources coupées correctement rapportées :

```jsonc
"sources": [
  { "source": "transit", "available": false, "reason": "network" },
  { "source": "sharedMobility", "available": false, "reason": "network" },
  { "source": "cyclePaths", "available": true },
]
```

> **Le cas « les trois en panne » ne se reproduit pas ainsi.** Couper aussi
> PostGIS ferait d'abord échouer la lecture des préférences (étape 3), qui
> précède la collecte et n'est délibérément pas dégradée — la requête s'arrête
> avant. En conditions réelles, `allSourcesFailed` correspond donc à un échec
> localisé de `cyclePaths` (verrou, géométrie corrompue) conjugué aux deux
> sources externes muettes. C'est ce que couvrent les tests unitaires, qui
> peuvent, eux, provoquer les trois échecs indépendamment.

## 10. Exécuter les tests

```bash
cd apps/api && npx jest src/modules/routes
```

Deux suites, sans réseau ni base. Les horloges ne sont **pas** simulées : les
faux minuteurs de Jest masqueraient précisément ce qu'on cherche à mesurer, à
savoir que les promesses progressent réellement en même temps.

## 11. Contraintes couvertes

| Contrainte | Traduction dans cette orchestration                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| C4         | Préférences lues avec l'identité du JWT, jamais du corps (anti-IDOR) ; extrémités revalidées           |
| C5         | Une seule latence au lieu de trois ; les deux extrémités d'une même source partent ensemble            |
| C10        | `Promise.allSettled`, budget borné, dégradation gracieuse, durées mesurées et journalisées             |
| C11        | Logs sans coordonnées ni libellés ; cause publiée générique, détail technique gardé côté serveur       |
| C12        | La préférence PMR du profil devient une contrainte de calcul envoyée à OTP, pas un filtre a posteriori |

## 12. Ce que ce ticket ne fait volontairement pas

- **La fusion multimodale** (Sprint 4) : les itinéraires rendus restent les mocks
  du scénario nominal. Le champ `sources`, lui, est bien réel.
- **Le filtrage des sources selon les préférences** — ne pas interroger GBFS pour
  qui n'utilise jamais de vélo serait une économie réelle (C5), mais c'est la
  fusion qui sait ce qu'elle peut construire. L'orchestration se contente de
  collecter.
- **Le calcul carbone** et **l'écriture de `search_history`** (étapes 6 et 7),
  qui viennent après la fusion.
- **L'exposition de la collecte** : rien ne permet encore de voir ces données
  brutes depuis l'extérieur. C'est l'objet d'UF-306
  ([`source-diagnostics-endpoint.md`](./source-diagnostics-endpoint.md)).
