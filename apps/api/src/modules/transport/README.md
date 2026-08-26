# Module `transport` — Sources de données transport (F3)

## Rôle

Adaptateur vers les **trois** sources du planificateur, toutes aux formats
standards (C9) :

- **GTFS** : transports en commun (arrêts, lignes, horaires) — **implémenté** (UF-302)
- **GBFS** : vélos et trottinettes en libre-service (stations, disponibilité) — **implémenté** (UF-303)
- **PostGIS** : aménagements cyclables et piétons de la Métropole — **implémenté** (UF-304)

Les deux premières lisent des flux **externes**, la troisième **notre propre
base**. La différence est assumée : les horaires et les vélos décrivent ce qui
circule, le réseau cyclable décrit ce qui est construit — quelques dizaines de
tronçons livrés par an. L'héberger retire une latence réseau et un point de panne
du chemin critique (C5/C10), et c'est ce qui rend `ST_DWithin` pertinent.

Consommé par le Service Itinéraire (module `routes`) via des appels parallèles (C10).

## Endpoints (protégés par le guard JWT global)

| Méthode | Route                               | Description                                  |
| ------- | ----------------------------------- | -------------------------------------------- |
| GET     | `/api/transport/status`             | État des deux sources GTFS/GBFS              |
| GET     | `/api/transport/stations/nearby`    | Stations en libre-service autour d'un point  |
| GET     | `/api/transport/cycle-paths/nearby` | Tronçons cyclables/piétons autour d'un point |

## Connecteur transports en commun (UF-302)

`TransitService.getTransitJourneys(from, to, options)` est le point d'entrée du
volet GTFS. Il interroge l'instance **OpenTripPlanner auto-hébergée** mise en
place en UF-301 et rend des trajets au format interne `TransitJourney`
(`@urbanflow/shared`), **indépendant de la structure d'OTP**.

```ts
const result = await transitService.getTransitJourneys(
  { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 },
  { label: 'Bellecour', lat: 45.757813, lng: 4.832011 },
  { departureAt: '2026-08-26T08:30:00+02:00', wheelchair: false, maxResults: 3 },
);
```

### Découpage interne

```
transport/
├── transit.service.ts           TC : date de service, requête, normalisation
├── shared-mobility.service.ts   mobilités douces : bornage, croisement des flux
├── transport.service.ts         état des sources (bandeau « mode dégradé » côté front)
├── dto/                         contrats HTTP + Swagger des endpoints du module
├── cycle-paths/
│   ├── cycle-paths.service.ts   recherche spatiale ST_DWithin, bornage
│   └── cycle-path.mapper.ts     libellés producteur -> contrats internes (fonctions pures)
├── otp/
│   ├── otp.client.ts            transport HTTP + timeout + qualification des pannes
│   ├── otp.mapper.ts            OTP -> contrats internes (fonctions pures)
│   ├── otp.types.ts             forme brute des réponses GraphQL d'OTP
│   └── service-date.ts          fuseau du réseau + recalage sur la période du graphe
└── gbfs/
    ├── gbfs.client.ts           auto-découverte + transport HTTP + caches à TTL
    ├── gbfs.mapper.ts           GBFS -> contrats internes (fonctions pures)
    ├── gbfs.types.ts            forme brute des flux GBFS
    └── distance.ts              distance haversine (sélection et tri des stations)
```

La frontière tient en une règle, appliquée aux trois connecteurs : **rien de la
structure d'OTP ne franchit le dossier `otp/`, rien de la structure de GBFS ne
franchit le dossier `gbfs/`, rien du vocabulaire de la Métropole de Lyon ne
franchit `cycle-paths/`**. Remplacer le moteur de routage (OTP 3, Navitia, API
opérateur), changer d'opérateur de vélos ou brancher une seconde métropole
n'imposerait de réécrire que le mapper concerné.

### Résilience — dégradation gracieuse (C10)

`getTransitJourneys` **ne lève jamais d'exception à cause du moteur**. Toute
défaillance devient un résultat exploitable :

| Situation                                 | Résultat rendu                                          |
| ----------------------------------------- | ------------------------------------------------------- |
| Trajets trouvés                           | `status: 'ok'`, `journeys: [...]`                       |
| Aucun trajet possible                     | `status: 'ok'`, `journeys: []` (ce n'est pas une panne) |
| OTP ne répond pas dans le délai           | `status: 'unavailable'`, `unavailableReason: 'timeout'` |
| OTP arrêté / injoignable                  | `status: 'unavailable'`, `unavailableReason: 'network'` |
| HTTP 5xx, erreur GraphQL, corps illisible | `status: 'unavailable'`, `'upstream-error'`             |

Le Service Itinéraire (UF-305) traduira `unavailable` en « ce mode n'est pas
proposé cette fois », sans perdre les autres options.

Seule une **entrée invalide** (coordonnées hors du domaine terrestre, date
illisible) lève une `BadRequestException` : c'est un défaut d'appel, pas une
panne d'infrastructure.

### Date de service : pourquoi une date peut être recalée

Le flux GTFS TCL officiel n'est plus téléchargeable anonymement (HTTP 401) ;
l'environnement de développement se rabat sur un miroir public qui est un
**instantané daté** (cf. [`docs/otp-gtfs.md`](../../../../../docs/otp-gtfs.md)).

Interroger le graphe à la date du jour ne renverrait donc **aucun trajet**. Le
connecteur interroge à la place une date équivalente située dans la période
couverte, **en conservant le jour de la semaine** (l'offre d'un dimanche n'a rien
à voir avec celle d'un mardi). Le résultat le signale sans rien masquer :

```jsonc
{ "requestedDate": "2026-08-26", "serviceDate": "2022-05-25", "dateAdjusted": true }
```

Avec un GTFS à jour, `dateAdjusted` vaut `false` et le recalage est un passe-plat.

### Correspondance des modes

Les modes OTP sont projetés sur l'enum `TransportMode` commun front/back (C9) ;
le mode brut reste exposé dans `leg.sourceMode` pour la traçabilité.

| OTP                                       | Interne | Justification                                                                  |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `WALK`                                    | `WALK`  |                                                                                |
| `BUS`, `TROLLEYBUS`, `COACH`              | `BUS`   | même service du point de vue de l'usager                                       |
| `TRAM`, `CABLE_CAR`, `GONDOLA`            | `TRAM`  |                                                                                |
| `SUBWAY`, `FUNICULAR`, `RAIL`, `MONORAIL` | `METRO` | les funiculaires F1/F2 sont exploités par TCL comme des lignes du réseau métro |
| mode inconnu                              | —       | le trajet est **écarté** : un mode faux fausserait le calcul carbone           |

Le graphe lyonnais ne contient que `BUS`, `SUBWAY`, `TRAM` et `FUNICULAR` : en
pratique, aucun trajet n'est écarté.

### Accessibilité PMR (C12)

`wheelchair: true` demande à OTP de ne retenir que les trajets praticables. Chaque
segment porte en plus son propre `accessible`, et un trajet n'est déclaré
accessible que si **tous** ses maillons le sont. Une accessibilité GTFS non
renseignée (`NO_INFORMATION`) est traitée comme **non accessible** : sur une
information manquante, le doute doit profiter à la sécurité de l'usager.

## Connecteur mobilités douces (UF-303)

`SharedMobilityService.getNearbyStations(point, options)` est le point d'entrée
du volet GBFS. Il lit les flux d'un opérateur de véhicules en libre-service
(**Vélo'v** à Lyon) et rend des stations au format interne
`SharedMobilityStation` (`@urbanflow/shared`), **indépendant de GBFS**.

```ts
const result = await sharedMobilityService.getNearbyStations(
  { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 },
  { radiusMeters: 500, limit: 10 },
);
```

```jsonc
{
  "status": "ok",
  "radiusMeters": 500,
  "publishedAt": "2026-08-26T09:14:35.000Z",
  "stations": [
    {
      "id": "3080",
      "name": "PART-DIEU / VILLETTE",
      "distanceMeters": 213,
      "vehiclesAvailable": 5,
      "vehicles": [
        { "mode": "BIKE", "electric": false, "count": 3 },
        { "mode": "BIKE", "electric": true, "count": 2 },
      ],
      "docksAvailable": 22,
      "renting": true,
      "returning": true,
      "lastReportedAt": "2026-08-26T09:13:48.000Z",
    },
  ],
}
```

### Auto-découverte plutôt que URL en dur (C9)

Le connecteur ne connaît qu'**une** URL : celle du document `gbfs.json`. Les
adresses de `station_information`, `station_status` et `vehicle_types` y sont
lues, comme la spécification GBFS le prévoit. Conséquence directe : un opérateur
qui réorganise ses chemins ne casse rien, et brancher un second réseau ne
demandera qu'une URL de plus en configuration.

Les documents GBFS **2.x** (`data` indexé par code langue) comme **3.x**
(`data.feeds`) sont acceptés — Vélo'v publie aujourd'hui du 2.3.

### Fraîcheur et mise en cache (C5, recette 2)

Les trois flux ne vieillissent pas à la même vitesse, ils ne sont donc pas
mémoïsés de la même façon :

| Flux                  | Volatilité réelle                        | Cache                        |
| --------------------- | ---------------------------------------- | ---------------------------- |
| `gbfs.json`           | quasi nulle                              | 1 h (en dur)                 |
| `station_information` | quelques changements par an              | 1 h (en dur)                 |
| `vehicle_types`       | quasi nulle                              | 1 h (en dur)                 |
| `station_status`      | permanente, mais pas seconde par seconde | `GBFS_STATUS_TTL_MS` (1 min) |

Le cache stocke la **promesse** en cours, pas seulement son résultat : dix
recherches simultanées après expiration du TTL déclenchent une seule requête
réseau. Un échec, lui, n'est jamais mémorisé — sinon une coupure d'une seconde
condamnerait la source pour toute la durée du TTL.

Deux horodatages distincts sont exposés, parce que ce sont deux choses
différentes :

- `publishedAt` — quand **l'opérateur** a publié le flux. C'est la fraîcheur de
  la réponse, et elle est vérifiable par le client sans nous croire sur parole.
- `station.lastReportedAt` — quand **la station elle-même** a rapporté son état.
  Une borne hors réseau depuis des heures reste publiée dans un flux frais.

`GET /api/transport/status` contourne ces caches et déclare la source
`degraded` lorsque le flux n'a plus été republié depuis plus d'un quart d'heure :
la donnée reste servie, mais le client sait qu'il doit la nuancer.

### Résilience — dégradation gracieuse (C10, recette 3)

`getNearbyStations` **ne lève jamais d'exception à cause de l'opérateur** :

| Situation                                  | Résultat rendu                                          |
| ------------------------------------------ | ------------------------------------------------------- |
| Stations trouvées                          | `status: 'ok'`, `stations: [...]`                       |
| Aucune station dans le rayon               | `status: 'ok'`, `stations: []` (ce n'est pas une panne) |
| Flux hors délai                            | `status: 'unavailable'`, `unavailableReason: 'timeout'` |
| Opérateur injoignable                      | `status: 'unavailable'`, `unavailableReason: 'network'` |
| HTTP 4xx/5xx, corps illisible, flux retiré | `status: 'unavailable'`, `'upstream-error'`             |

L'endpoint répond **`200 OK` même en cas de panne amont** : du point de vue du
client, sa requête a bien abouti, c'est le mode « vélo » qui n'est pas proposé
cette fois. Un `503` lui ferait croire que sa requête est fautive.

### Stations écartées, et pourquoi

| Cas                           | Décision   | Raison                                                                   |
| ----------------------------- | ---------- | ------------------------------------------------------------------------ |
| État non publié               | écartée    | l'annoncer à zéro serait affirmer quelque chose de faux                  |
| `is_installed: false`         | écartée    | borne évènementielle démontée ou pas encore déployée : elle n'existe pas |
| `is_renting: false`           | **gardée** | elle reste un point de **retour** valable — `renting: false` le dit      |
| Coordonnées absentes/absurdes | écartée    | elle fausserait le tri par distance                                      |

### Correspondance des modes

Les `form_factor` GBFS sont projetés sur l'enum `TransportMode` commun
front/back (C9), et la motorisation est portée séparément — un vélo à assistance
reste un vélo, mais n'a ni la même portée ni le même facteur d'émission.

| GBFS `form_factor`                       | Interne   | Justification                                                |
| ---------------------------------------- | --------- | ------------------------------------------------------------ |
| `bicycle`, `cargo_bicycle`               | `BIKE`    |                                                              |
| `scooter`, `scooter_standing`, `_seated` | `SCOOTER` |                                                              |
| `moped`, `car`, `other`                  | —         | le type est **écarté** : ce ne sont pas des mobilités douces |

Vélo'v ne publie que `bicycle`, en deux motorisations (`mechanical`,
`electrical`) : en pratique aucun type n'est écarté. Le total
`vehiclesAvailable` reste celui publié par l'opérateur — seule la **ventilation**
ignore les types dont le mode ne nous est pas connu.

### Distance : haversine en mémoire, pas `ST_DWithin`

Les stations viennent d'un flux externe, pas de la base. Les charger en table
temporaire pour un `ST_DWithin` coûterait un aller-retour SQL et une écriture
disque à chaque recherche, là où quelques centaines de haversines se comptent en
dizaines de microsecondes (C5). `ST_DWithin` reste l'outil du jour où la donnée
est persistée — les pistes cyclables, par exemple.

Le rayon est borné entre **50 m** et **2 km**. Le plancher n'est pas arbitraire :
en dessous, la précision d'un GPS de smartphone en ville (20 à 60 m — C6) rendrait
le résultat aléatoire. Le plafond évite qu'une requête ne balaie tout le réseau.

## Connecteur pistes cyclables (UF-304)

`CyclePathsService.getCycleSegments(point, options)` est le point d'entrée du
volet PostGIS. Il interroge **notre table** `cycle_paths`, peuplée par le script
d'import depuis le flux ouvert de la Métropole, et rend des tronçons au format
interne `CycleSegment` (`@urbanflow/shared`).

```ts
const result = await cyclePathsService.getCycleSegments(
  { label: 'Part-Dieu', lat: 45.760515, lng: 4.859057 },
  { radiusMeters: 300, limit: 20 },
);
```

```jsonc
{
  "segments": [
    {
      "id": "7298",
      "name": "Tunnel Marius Vivier-Merle",
      "facilityType": "CYCLE_TRACK",
      "sourceFacilityType": "Piste Cyclable",
      "network": "Voies Lyonnaises",
      "surface": "Matériaux liés (asphaltes, enrobés, bétons et nouveaux liants)",
      "distanceMeters": 68,
      "lengthMeters": 742,
      "geometry": { "type": "MultiLineString", "coordinates": [[[4.858743, 45.757074]]] },
    },
  ],
  "radiusMeters": 300,
  "datasetImportedAt": "2026-08-26T11:01:04.368Z",
}
```

### Peupler la table

```bash
make cycle-import                                  # depuis la racine
npm run db:import:cycle-paths --workspace apps/api # équivalent sans make
```

4 067 tronçons réalisés, 1 124 km cumulés. Le script est idempotent et
transactionnel ; le détail de la source et de l'import est dans
[`docs/cycle-paths-postgis.md`](../../../../../docs/cycle-paths-postgis.md).

### `geography` plutôt que `geometry` — la décision structurante

`search_history` (UF-204) stocke des `geometry(Point, 4326)`, `cycle_paths`
stocke des `geography(MultiLineString, 4326)`. Ce n'est pas une inconséquence :

|                            | `geometry(4326)`        | `geography(4326)`    |
| -------------------------- | ----------------------- | -------------------- |
| Unité de `ST_DWithin`      | **degrés**              | **mètres**           |
| `ST_DWithin(geom, p, 300)` | cherche dans ~33 000 km | cherche dans 300 m   |
| Index GiST                 | `gist_geometry_ops_2d`  | `gist_geography_ops` |

Un rayon en mètres sur une `geometry` imposerait d'écrire
`ST_DWithin(geom::geography, …)` : correct, mais caster la **colonne** rend
l'index inutilisable. Le type porte donc la sémantique métrique, plutôt que
chaque requête.

### `ST_DWithin`, et pas `ST_Distance(…) <= rayon`

Les deux formes rendent les mêmes tronçons ; seule la première est indexable.
Mesuré sur le jeu de développement (4 067 lignes) :

| Plan                         | Lignes examinées | Temps   |
| ---------------------------- | ---------------- | ------- |
| `Bitmap Index Scan` (GiST)   | 46               | 1,1 ms  |
| `Seq Scan` (index désactivé) | 4 067            | 50,6 ms |

Environ **45×**, et l'écart se creuse avec le volume : le parcours séquentiel est
linéaire, l'index ne l'est pas (C10). Un test fige la forme de la requête, pour
qu'une réécriture bien intentionnée ne la fasse pas retomber en parcours complet.

### Distance au tronçon, pas à son début

`ST_Distance` sur une ligne rend la distance au point **le plus proche**. Une
Voie Lyonnaise de deux kilomètres qui passe devant la porte est donc à quelques
mètres — ce qu'une distance à son point de départ ou à son centroïde aurait raté.
En contrepartie, `lengthMeters` est la longueur **totale** du tronçon : il peut
légitimement dépasser le rayon demandé.

### Pas de `status` dans la réponse, et c'est délibéré

Les réponses GTFS et GBFS portent un `status: 'ok' | 'unavailable'` parce
qu'elles décrivent des sources externes dont la panne doit être dégradée
gracieusement. Ici la source est notre propre base : si PostGIS ne répond pas, le
JWT n'a pas pu être vérifié non plus. Il n'y a rien à dégrader — l'erreur remonte
en `500` et doit se voir.

En revanche `datasetImportedAt` sépare deux silences qui se ressemblent : un
tableau vide **avec** une date signifie « pas d'aménagement ici », le même
tableau avec `null` signifie « l'import n'a jamais été lancé ».

### Correspondance des types d'aménagement

| Libellé source                            | Interne         |
| ----------------------------------------- | --------------- |
| `Piste Cyclable`                          | `CYCLE_TRACK`   |
| `Bande Cyclable`                          | `CYCLE_LANE`    |
| `Voie verte`                              | `GREENWAY`      |
| `Double sens cyclable`, `Vélorue`, `CVCB` | `SHARED_STREET` |
| `Couloir bus vélo élargi` / `non élargi`  | `BUS_LANE`      |
| `Goulotte ou rampe`                       | `CROSSING`      |
| libellé inconnu                           | `OTHER`         |

Un libellé inconnu devient `OTHER` plutôt que d'écarter le tronçon. C'est
l'inverse du choix fait pour les modes OTP — et pour une raison : un mode faux
fausserait le calcul carbone, alors qu'un type d'aménagement inconnu n'empêche
pas l'aménagement d'exister et d'être cyclable.

## Configuration

| Variable             | Rôle                                             | Défaut                    |
| -------------------- | ------------------------------------------------ | ------------------------- |
| `OTP_BASE_URL`       | Racine du service OpenTripPlanner                | `http://localhost:8080`   |
| `OTP_TIMEOUT_MS`     | Délai maximal accordé au moteur (1 s–30 s)       | `12000`                   |
| `GBFS_DISCOVERY_URL` | Document `gbfs.json` de l'opérateur              | flux Vélo'v du Grand Lyon |
| `GBFS_TIMEOUT_MS`    | Délai maximal accordé à chaque flux (0,5 s–15 s) | `5000`                    |
| `GBFS_STATUS_TTL_MS` | Mémoïsation du statut temps réel (5 s–10 min)    | `60000`                   |

Le volet pistes cyclables n'a **aucune variable d'exécution** : l'API ne lit
que la table. Seul le script d'import accepte un `CYCLE_PATHS_SOURCE_URL`
facultatif, pour rejouer un export local ou brancher une autre métropole.

Validées au démarrage : l'API refuse de démarrer si elles manquent (fail-fast, C4).

Le défaut de 12 s pour OTP vient de la mesure : sur le graphe lyonnais en
développement, une requête `plan` prend de 1,7 s à 8,3 s selon la charge de la
machine et selon que la journée d'exploitation demandée est déjà en cache côté
OTP. Une instance correctement dimensionnée répond bien en deçà — d'où le
réglage par variable.

Le délai GBFS est bien plus court, et c'est délibéré : là où le moteur de routage
_calcule_, l'opérateur GBFS ne fait que servir un fichier statique — quelques
centaines de millisecondes en régime normal.

## Éco-conception (C5)

- La période couverte par le graphe est **mémoïsée une heure** pour les
  recherches d'itinéraires : elle ne change qu'à la reconstruction du graphe, la
  réinterroger à chaque recherche serait une requête réseau gratuite.
  `GET /api/transport/status` est la seule exception et contourne ce cache — un
  état de service lu dans un cache d'une heure annoncerait un moteur
  « opérationnel » une heure après son arrêt.
- La requête GraphQL ne demande que les champs réellement consommés par le format
  interne — chaque champ superflu est du calcul côté OTP et des octets sur le réseau.
- Les tracés arrivent en polyligne encodée (≈ 5× plus compact que du GeoJSON) et
  sont décodés côté serveur.
- Les flux GBFS sont mémoïsés **selon leur volatilité réelle** (tableau plus
  haut), et les requêtes concurrentes sur un même flux sont dédoublonnées : dix
  usagers simultanés ne déclenchent qu'un seul téléchargement.
- Les trois flux partent en parallèle, jamais en cascade : la requête de
  l'usager ne paie pas trois latences réseau bout à bout.
- Le nombre de stations rendues est plafonné (10 par défaut, 50 au maximum), tout
  comme le rayon : pas de réponse démesurée sur un réseau mobile.
- Le jeu de données cyclable ne conserve que **4 attributs sur les 23 publiés** :
  ceux qui changent une décision d'itinéraire ou un affichage. Les traçés sont
  rendus à **six décimales** (~11 cm), là où les neuf par défaut de
  `ST_AsGeoJSON` décriraient le millimètre et gonfleraient chaque réponse d'un
  tiers pour une exactitude qui n'existe pas dans la donnée source.
- Les aménagements cyclables sont **hébergés** plutôt qu'interrogés à chaque
  recherche : une latence réseau et un point de panne en moins par requête.

## Sécurité (C4/C11)

- Les paramètres passent par les **variables GraphQL**, jamais par concaténation
  dans le document : pas de surface d'injection.
- Les coordonnées sont revalidées avant appel, côté DTO **et** côté service
  (défense en profondeur) — un appel interne fautif ne passe pas par le DTO.
- Les logs comptent les trajets et les stations, ils ne journalisent jamais le
  détail ni la position interrogée : un itinéraire, comme un point de départ,
  est une donnée de déplacement.
- Les flux GBFS sont publics : aucun en-tête d'identification n'est envoyé, et
  la position de l'usager ne quitte jamais l'API.
- Les requêtes PostGIS passent par le _tagged template_ `$queryRaw` : chaque
  valeur devient un paramètre lié côté serveur, jamais une concaténation — y
  compris les coordonnées venues du client (OWASP A03). L'import envoie chaque
  lot en **un seul paramètre JSON** déplié par `jsonb_array_elements`, ce qui
  garde le texte SQL constant bien que les libellés viennent d'un tiers.

## Dépendances

- `OtpClient` (interne au module) → OpenTripPlanner, API GraphQL `/otp/gtfs/v1`
- `GbfsClient` (interne au module) → flux GBFS de l'opérateur, via `gbfs.json`
- `PrismaService` (global) → PostgreSQL + PostGIS, table `cycle_paths`
- `@urbanflow/shared` pour les contrats `TransitJourney` / `TransitJourneysResult`,
  `SharedMobilityStation` / `NearbyStationsResult` et `CycleSegment` /
  `CycleSegmentsResult`

## Tests

```bash
cd apps/api && npx jest src/modules/transport
```

Onze suites, **sans réseau, base ni conteneur** (`fetch` et `$queryRaw` simulés)
— exécutables en CI et insensibles à l'état des sources amont :

| Volet   | Suites                                                              |
| ------- | ------------------------------------------------------------------- |
| GTFS    | `otp.mapper`, `otp.client`, `service-date`, `transit.service`       |
| GBFS    | `gbfs.mapper`, `gbfs.client`, `distance`, `shared-mobility.service` |
| PostGIS | `cycle-paths.service`, `cycle-path.mapper`                          |
| Commun  | `transport.service` (état des sources externes)                     |

Les suites PostGIS vérifient la **forme** de la requête (prédicat `ST_DWithin`,
ordre longitude/latitude, paramètres liés, bornage). Que la requête soit
réellement _indexée_ relève de l'`EXPLAIN` documenté dans la recette — un test
unitaire ne peut pas le prouver.

Recettes des tickets : UF-302 dans
[`docs/otp-gtfs.md`](../../../../../docs/otp-gtfs.md) section 10, UF-303 dans
[`docs/gbfs-velov.md`](../../../../../docs/gbfs-velov.md), UF-304 dans
[`docs/cycle-paths-postgis.md`](../../../../../docs/cycle-paths-postgis.md).

## Contraintes couvertes

C4 (variables GraphQL, paramètres SQL liés, revalidation des entrées),
C5 (mémoïsation graduée, appels parallèles, champs et volumes minimaux, données
cyclables hébergées), C6 (rayon plancher aligné sur la précision GPS réelle),
C8 (jeu de données cyclable sans donnée personnelle), C9 (GTFS, GBFS et son
auto-découverte, WFS/GeoJSON, SRID 4326, contrats partagés), C10 (timeouts
bornés, dégradation gracieuse, index GiST mesuré), C11 (logs sans donnée de
déplacement), C12 (accessibilité PMR, revêtement des aménagements exposé).
