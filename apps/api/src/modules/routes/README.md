# Module `routes` — Planificateur multimodal (F2)

## Rôle

« Service Itinéraire » de l'architecture logique : calcule les itinéraires multimodaux
(TC + mobilités douces), orchestré selon le diagramme de séquence du MVP
(CLAUDE.md section 4).

## Endpoints (protégés par le guard JWT global)

| Méthode | Route              | Description                                            | Statut                      |
| ------- | ------------------ | ------------------------------------------------------ | --------------------------- |
| POST    | `/api/routes/plan` | Itinéraires multimodaux + CO₂, classés selon le profil | définitif (UF-402), le seul |

Contrat d'entrée : `{ from: {label, lat, lng}, to: {...} }` — **sans `userId`**.
L'identité vient du JWT et de lui seul (anti-IDOR, C4) ; le `ValidationPipe`
global rejette en `400` une requête qui en enverrait encore un.

Contrat de sortie : `{ itineraries, sortedBy, sources, searchHistoryId }`.

⚠️ Les **coordonnées sont obligatoires** depuis UF-305 : les trois sources
travaillent sur des points, et le géocodage est fait par le client (UF-203). Un
label seul donne un `400` explicite — pas une liste vide inexplicable.

## Où en est le flux

| Étape                                           | Ticket | État |
| ----------------------------------------------- | ------ | ---- |
| 3. Lecture des préférences profil (PostGIS)     | UF-107 | ✅   |
| 13-18. Collecte **parallèle** des trois sources | UF-305 | ✅   |
| 5. Fusion en itinéraires multimodaux            | UF-401 | ✅   |
| 6. `computeFootprint` par itinéraire            | UF-401 | ✅   |
| 16-17. Détail carbone **par segment**           | UF-501 | ✅   |
| 9. Tri selon la priorité du profil              | UF-401 | ✅   |
| 7 et 18. Sauvegarde `search_history`            | UF-402 | ✅   |

**Plus aucun itinéraire n'est simulé.** Une liste vide signifie désormais
qu'aucune chaîne continue n'a pu être formée — et `sources` dit si c'est faute de
données ou faute d'options.

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

### Pourquoi pas le `404` du diagramme (UF-405)

Le flux de référence (CLAUDE.md §4, étape 5) prévoit un **404 si aucun trajet**.
L'endpoint répond `200` avec une liste vide, et c'est un écart assumé : un corps
d'erreur 404 ne transporterait pas `sources`, or c'est la **seule** chose qui
distingue « aucun trajet ne relie ces deux points » de « aucune source n'a
répondu ». Ces deux situations n'appellent pas le même message ni le même ton
côté client — l'une est un résultat, l'autre une panne à réessayer (C10).

Le client traite le `404` malgré tout, comme un résultat vide et jamais comme une
panne : un proxy ou une `NEXT_PUBLIC_API_URL` mal réglée peut le produire sans
que l'API en sache rien (voir `apps/web/features/planner/README.md`, « Cas non
nominaux »).

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

## Fusion en itinéraires multimodaux (UF-401)

`mergeIntoItineraries(sources, from, to, prefs)` transforme les données brutes de
la collecte en propositions de bout en bout. C'est la pièce la plus algorithmique
du projet.

```
routes/
└── merge/
    ├── itinerary-merger.ts   familles de propositions, préférences, plafond
    ├── travel-model.ts       vitesses, facteurs de détour, coût de prise du vélo
    └── cycle-coverage.ts     part du corridor desservie par un aménagement (UF-304)
```

Détail complet et recette :
[`docs/itinerary-merge.md`](../../../../../docs/itinerary-merge.md).

### Quatre familles de propositions

| Famille        | Chaîne                      | Ce qu'elle apporte                                |
| -------------- | --------------------------- | ------------------------------------------------- |
| `transit`      | marche → TC → marche        | la référence, calculée par OTP sur le réseau réel |
| `bike-transit` | marche → vélo → TC → marche | supprime la longue marche d'accès ou de sortie    |
| `bike`         | marche → vélo → marche      | porte-à-porte, sans attendre de véhicule          |
| `walk`         | marche                      | l'option évidente quand c'est court               |

### Une fonction pure, pas un service

Aucune I/O, aucune injection : tout est déduit de `CollectedSources`. C'est ce
qui permet de tester le cœur du produit sans OTP, sans flux GBFS et sans PostGIS,
sur des jeux de données figés — et de le présenter isolément en soutenance.

### Trois invariants

1. **Continuité** — `segments[i].to` est toujours l'origine de `segments[i+1]`,
   en libellé comme en coordonnées. Les segments trop courts (moins de 30 m) sont
   absorbés par leur voisin plutôt que supprimés, pour ne pas ouvrir de trou.
2. **Plafond** — au plus **5** itinéraires, et la sélection prend d'abord le
   meilleur de **chaque famille**. Sans cette règle, trois variantes du même
   métro rempliraient le plafond et masqueraient l'option vélo, alors que c'est
   précisément la comparaison entre familles que le produit veut provoquer.
3. **Dégradation gracieuse** — une source muette retire les familles qui en
   dépendent, elle n'invalide pas les autres (C10).

### Un rabattement qu'on peut réellement faire

Le vélo n'est proposé que si les **deux** bornes existent dans les données
collectées : celle où on le prend, et celle où on le rend. Sans quoi on
proposerait d'abandonner un Vélo'v sur le trottoir.

C'est aussi pourquoi le collecteur élargit son rayon de recherche de bornes à
900 m pour la planification : il en faut une près de l'**arrêt d'embarquement**,
pas seulement près de l'usager. Le surcoût réseau est nul — le connecteur GBFS
mémoïse les flux entiers et filtre en mémoire (C5).

### Comment les préférences agissent

| Préférence        | Effet                | Pourquoi                                                                                                   |
| ----------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `reducedMobility` | **filtre dur** (C12) | ce n'est pas un goût mais une contrainte : proposer un trajet impraticable serait une faute                |
| `maxWalkMinutes`  | **filtre dur**       | c'est un maximum annoncé par l'usager ; le dépasser reviendrait à ignorer sa saisie                        |
| `preferredModes`  | **sélection**        | n'exclut rien : un profil « métro et vélo » ne doit pas rester sans réponse le jour où seul un bus circule |
| `priority`        | **tri publié**       | `carbonAsc` pour « écolo », `durationAsc` pour « rapide » — et `sortedBy` le dit au client                 |

### Ce que les tronçons cyclables changent

Un corridor desservi par un aménagement connu se parcourt plus directement : le
facteur de détour appliqué à la distance à vol d'oiseau passe de 1,45 à 1,20 à
mesure que la couverture augmente. La mesure est une **proximité** (le corridor
est-il équipé ?), pas un calage sur le réseau — un vrai routeur cyclable reste la
bonne réponse le jour où le produit en aura un.

### Ce que ce n'est pas

Il n'y a **pas de routeur** pour les portions que nous fabriquons : marche et
vélo sont estimés depuis une distance à vol d'oiseau, un facteur de détour et une
vitesse moyenne (`travel-model.ts`), et leur tracé est une droite. C'est
suffisant pour comparer des options à quelques minutes près ; ce n'est pas une
feuille de route au carrefour près, et c'est assumé.

## L'endpoint définitif (UF-402)

`POST /api/routes/plan` enchaîne désormais toute la séquence de référence :
vérification du JWT → lecture du profil → collecte parallèle → fusion → carbone →
**historique** → réponse. C'est le seul endpoint du module.

### Deux extrémités, et rien d'autre

Le diagramme de séquence du MVP portait un `{ from, to, userId }`. L'endpoint
définitif **n'accepte plus de `userId`**. Le service l'ignorait déjà — il lisait
l'identité du JWT — mais le garder dans le contrat entretenait l'idée qu'un
compte se désigne depuis le corps de la requête, et laissait un champ à
falsifier au premier oubli de contrôle.

Le supprimer transforme la précaution en garde active : le `ValidationPipe`
global (`whitelist` + `forbidNonWhitelisted`) rejette en `400` toute requête qui
en envoie un. C'est déjà le contrat de `POST /api/search-history` (UF-204) — les
deux écritures de trajet parlent le même langage.

### La recherche est enregistrée à chaque appel (étape 18)

Chaque planification écrit une ligne dans `search_history` pour le compte du JWT,
et la réponse porte son identifiant dans `searchHistoryId`.

| Question                               | Réponse                                                              |
| -------------------------------------- | -------------------------------------------------------------------- |
| Quand ?                                | dès la soumission, **en parallèle de la collecte**                   |
| Même si les trois sources se taisent ? | oui — l'historique dit ce qui a été _cherché_, pas ce qu'on a trouvé |
| Avec l'option retenue ?                | non : à l'étape 18, aucune option n'est encore choisie               |
| Et si l'écriture échoue ?              | `searchHistoryId: null`, les itinéraires sont rendus quand même      |

**Pourquoi en parallèle.** Le trajet est connu dès la validation des extrémités ;
attendre la collecte pour l'écrire ajouterait l'insertion à la latence de la
source la plus lente au lieu de la glisser dessous (C5).

**Pourquoi sans `selectedSummary` ni `carbonGrams`.** Inscrire d'office la
première proposition ferait passer un classement du serveur pour un choix de
l'usager, et fausserait le tableau de bord carbone du Sprint 5 — qui doit
compter des déplacements, pas des suggestions. C'est l'écran de résultats
(UF-404) qui saura ce qui a été retenu.

**Pourquoi un échec ne remonte pas.** Ne pas mémoriser un trajet est un
désagrément ; perdre pour cette raison des itinéraires déjà calculés serait une
régression fonctionnelle (C10). La cause reste dans les logs du serveur, sans
libellé ni coordonnées (C11).

> Le client n'a donc **plus** à appeler `POST /search-history` après un
> `planRoutes` : il dupliquerait la ligne que le serveur vient d'écrire.

### L'endpoint de test UF-306 a été retiré

`POST /api/routes/sources`, le `SourceDiagnosticsService`, l'écran
`/dev/sources`, leurs DTO et la variable `ROUTES_SOURCES_DEBUG` ont été
**supprimés**. Il avait servi à vérifier les trois connecteurs avant que la
fusion n'existe — une liste d'itinéraires vide ne disait alors pas si le tort
revenait à la fusion ou à une source muette.

Il était déjà éteint hors développement (`404`), mais son code partait dans le
bundle de production : une route qui publie la **cause technique réelle** de nos
pannes y restait à un drapeau d'environnement près (C11). Un accessoire de
vérification qui a fait son office se retire.

Ce qu'il apportait est couvert autrement : le champ `sources` de `/routes/plan`
dit quelle source a répondu, et le détail technique se lit dans les logs du
serveur, où `SourceCollectorService` journalise chaque échec. L'archive de sa
conception reste dans
[`docs/source-diagnostics-endpoint.md`](../../../../../docs/source-diagnostics-endpoint.md) ;
le code est retrouvable dans l'historique Git (`git show 6c78520`).

## Dépendances

- `TransportModule` — les **trois** sources : `TransitService` (GTFS, UF-302),
  `SharedMobilityService` (GBFS, UF-303) et `CyclePathsService`
  (`ST_DWithin` sur PostGIS, UF-304)
- `UsersModule` (préférences, étape 3), `CarbonModule` (barème CO₂, étape 6)
- `SearchHistoryModule` — en **écriture** (UF-402, étape 18) : chaque
  planification enregistre le trajet cherché sur le compte du JWT
- `SourceCollectorService` — interne au module, volontairement **non exporté** :
  l'orchestration est une étape du planificateur, pas un service que d'autres
  modules auraient à consommer. L'exporter laisserait court-circuiter la lecture
  des préférences qui la précède.

## Tests

```bash
cd apps/api && npx jest src/modules/routes
```

Cinq suites, sans réseau ni base. Les horloges ne sont **pas** simulées dans les
tests de collecte : les faux minuteurs de Jest masqueraient exactement ce qu'on
veut mesurer, à savoir que les trois promesses progressent réellement en même
temps.

`merge/itinerary-merger.spec.ts` couvre la recette d'UF-401 point par point sur
le scénario nominal Part-Dieu → Bellecour : propositions distinctes, chaîne
continue, préférences (deux profils), plafond. Il vérifie aussi (UF-403) que les
tracés de segments recollés redonnent **exactement** la géométrie d'ensemble de
l'itinéraire : deux sources de vérité géométriques qui divergeraient
afficheraient un trait coloré à côté du trajet réel.

Trois cas y ont été ajoutés par UF-404, autour de la seule règle qui compte pour
les horaires : **on n'en invente pas**. Un trajet TC republie ceux du moteur, un
tout-vélo n'en a aucun, un rabattement à vélo ancre les siens sur le métro qu'il
précède.

## Horaires publiés (UF-404)

Le panneau de résultats affiche « Départ 09:41 · Arrivée 10:03 ». Sans horaires,
deux options de même durée sont indiscernables alors que l'une part dans deux
minutes et l'autre dans un quart d'heure.

| Champ                      | Portée              | Origine                                         |
| -------------------------- | ------------------- | ----------------------------------------------- |
| `RouteSegment.departureAt` | un segment          | l'horaire GTFS du moteur, quand il existe       |
| `Itinerary.departureAt`    | l'itinéraire entier | ancré sur les segments datés, décalé des autres |

**Un horaire est une donnée de source, pas un calcul.** Un pas TC en porte un
parce que le réseau l'a publié ; un tronçon vélo synthétisé à partir d'une
distance et d'une vitesse n'en a aucun, et lui en fabriquer un ferait passer une
estimation pour une information de réseau.

D'où la règle d'ancrage au niveau de l'itinéraire : la fenêtre part des segments
que la source date, et les segments voisins sont décalés de **leur propre
durée** — la même arithmétique que `durationMinutes`, qui les additionne déjà.
Prendre le métro de 08:15 après onze minutes de vélo, c'est partir à 08:04.

Quand **aucun** segment n'est daté (itinéraire tout-vélo), les deux champs sont
absents : cet itinéraire ne part à aucune heure particulière, il part quand
l'usager décide. Le client affiche alors sa seule durée.

## Empreinte publiée (UF-501)

Chaque itinéraire porte deux champs carbone, et ils ne font pas double emploi :

| Champ                   | À quoi il sert                                           |
| ----------------------- | -------------------------------------------------------- |
| `Itinerary.carbonGrams` | la **clé de tri**, comparée d'une carte à l'autre        |
| `Itinerary.carbon`      | la **justification** : ligne par segment + facteur ADEME |

Les deux sortent du **même appel** à `CarbonService.computeFootprint`, donc
`carbonGrams === carbon.totalGrams` par construction — il n'y a pas deux calculs
à garder en phase.

Le service étant l'autorité sur le barème, ses lignes **écrasent** les
`carbonGrams` que la fusion avait posés sur les segments : la fusion n'estime que
pour classer ses candidats, elle ne publie pas. Deux chiffres pour la même chose
à l'écran, l'un de la fusion et l'autre du service, finiraient un jour par ne
plus coïncider.

La réponse porte aussi `carbon.carEquivalentGrams` — ce que la même distance
aurait coûté seul en voiture. La voiture solo n'est pas un mode que le
planificateur propose ; c'est l'étalon qui rend un gramme lisible. Barème,
méthodologie et source : [`modules/carbon/README.md`](../carbon/README.md).

## Géométrie publiée (C9)

La réponse porte **deux niveaux** de tracé, et les deux sont nécessaires :

| Champ                            | Portée              | À quoi il sert                                |
| -------------------------------- | ------------------- | --------------------------------------------- |
| `Itinerary.geometry`             | l'itinéraire entier | cadrage, mise en cache, export                |
| `RouteSegment.geometry` (UF-403) | un segment          | colorer par mode et changer de motif de trait |

Le second n'est pas une redondance : la `LineString` d'ensemble ne dit pas où la
marche s'arrête et où le métro commence. Le client aurait pu tenter de la
redécouper en s'appuyant sur les distances, mais ce serait reconstruire par
approximation une information que le serveur possède exactement.

Les deux appliquent la même règle : les points en double aux jonctions sont
écartés, et sous deux points **rien** n'est publié plutôt qu'une `LineString`
invalide au sens de la RFC 7946.

## Contraintes couvertes

C4 (validation, anti-IDOR, coordonnées exigées, plus aucun `userId` dans le
corps, surface de diagnostic retirée), C8 (l'historique enregistre la recherche,
pas un choix qui n'a pas eu lieu), C9 (GeoJSON
LineString, contrats partagés), C10 (appels parallèles, budget borné,
dégradation gracieuse, durées mesurées), C11 (logs sans donnée de déplacement,
cause publiée générique hors diagnostic), C12 (préférence PMR propagée au moteur
de routage).
