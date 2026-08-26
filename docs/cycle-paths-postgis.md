# Pistes cyclables en PostGIS — requêtes géospatiales (UF-304)

Source de données du réseau cyclable lyonnais, et recette du ticket UF-304.
Complète [`otp-gtfs.md`](./otp-gtfs.md) (transports en commun) et
[`gbfs-velov.md`](./gbfs-velov.md) (vélos en libre-service) : c'est la
**troisième** des trois sources que le Service Itinéraire interroge en parallèle
à l'étape 4 du flux de référence.

---

## 1. Ce que cette source apporte, et pourquoi elle est chez nous

Les deux autres sources décrivent ce qui **circule** — des horaires qui changent
chaque jour, des vélos qui bougent à la minute. Le réseau cyclable décrit ce qui
est **construit** : la Métropole livre quelques dizaines de tronçons par an.

Cette différence de nature commande une différence de traitement. GTFS et GBFS
sont interrogés à la volée ; les aménagements cyclables sont **importés une fois
dans PostGIS**. Trois conséquences directes :

- une latence réseau et un point de panne en moins sur le chemin critique du
  planificateur (C5/C10) ;
- des requêtes de proximité possibles (« qu'y a-t-il dans 300 m »), impraticables
  sur un flux qu'on ne possède pas ;
- et surtout : **c'est ce qui justifie PostGIS dans ce projet**. Sans elle, la
  base ne stockerait que des points d'historique, et un couple de flottants y
  suffirait. `ST_DWithin` sur 4 000 lignes géométriques, lui, ne se remplace pas
  par du JavaScript.

Étapes 12-13 du flux : `ST_DWithin (pistes cyclables) → tronçons cyclables /
piétons`.

## 2. La source retenue

|                      |                                                                         |
| -------------------- | ----------------------------------------------------------------------- |
| **Producteur**       | Métropole de Lyon — Direction de la voirie                              |
| **Jeu de données**   | `pvo_patrimoine_voirie.pvoamenagementcyclable` (aménagements cyclables) |
| **Protocole**        | WFS 2.0, sortie GeoJSON, reprojection serveur en EPSG:4326              |
| **Authentification** | aucune — flux public                                                    |
| **Licence**          | Licence Ouverte (Métropole de Lyon)                                     |
| **Volume**           | 4 714 entités publiées, dont **4 067 réalisées** — 1 124 km cumulés     |
| **Mise à jour**      | au fil des livraisons de voirie ; un réimport trimestriel suffit        |

L'URL complète est le défaut de
[`prisma/import-cycle-paths.ts`](../apps/api/prisma/import-cycle-paths.ts) ; elle
n'a pas à être configurée pour un poste de développement.

### Reprojection côté serveur plutôt que dans le code

Le producteur publie nativement en **EPSG:3946** (Lambert Conforme Conique zone
46, la projection métrique du Grand Lyon). Le paramètre `SRSNAME=EPSG:4326` de la
requête WFS demande la reprojection au serveur : le script n'embarque donc
aucune bibliothèque de projection, et la donnée arrive dans le SRID qui est déjà
celui de la Geolocation API, du GeoJSON standard et de la colonne (C6/C9).

### Les aménagements en projet sont écartés

Le flux mélange l'existant et le programmé, via un champ `validite` :

| `validite`                            | Entités | Importées |
| ------------------------------------- | ------- | --------- |
| `Validé`                              | 4 067   | oui       |
| `En projet ou en cours de validation` | 647     | non       |

Un aménagement sur sept n'est pas encore construit. Proposer à un cycliste une
piste qui n'existe pas serait pire qu'une absence d'information — d'où un filtre
**à l'import** et non à la requête : la table signifie ainsi exactement « les
aménagements praticables aujourd'hui », et aucun appelant ne peut oublier le
filtre.

## 3. Le schéma, et le choix de `geography`

```sql
CREATE TABLE cycle_paths (
    id            UUID PRIMARY KEY,
    source_id     TEXT NOT NULL,          -- gid du producteur
    name          TEXT,
    facility_type TEXT NOT NULL,
    network       TEXT,
    surface       TEXT,
    geom          geography(MultiLineString, 4326) NOT NULL,
    imported_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX cycle_paths_source_id_key ON cycle_paths(source_id);
CREATE INDEX cycle_paths_geom_idx ON cycle_paths USING GIST (geom gist_geography_ops);
```

### `geography` et non `geometry` — la décision structurante du ticket

`search_history` (UF-204) stocke des `geometry(Point, 4326)`. Ici le type change,
et ce n'est pas une inconséquence :

|                            | `geometry(4326)`            | `geography(4326)`    |
| -------------------------- | --------------------------- | -------------------- |
| Unité de `ST_DWithin`      | **degrés**                  | **mètres**           |
| `ST_DWithin(geom, p, 300)` | cherche dans ~33 000 km     | cherche dans 300 m   |
| `ST_Length`                | degrés (sans signification) | mètres               |
| Index GiST                 | `gist_geometry_ops_2d`      | `gist_geography_ops` |

Le ticket demande un rayon en mètres. Sur une `geometry`, il faudrait écrire
`ST_DWithin(geom::geography, point::geography, 300)` — correct, mais le cast de
la **colonne** rend l'index inutilisable : PostgreSQL ne peut pas se servir d'un
index posé sur `geom` pour évaluer une expression `geom::geography`. Il faudrait
alors un second index sur l'expression, non exprimable dans le schéma Prisma.

Stocker directement en `geography` inscrit la sémantique métrique **dans le
type** au lieu de la rattraper dans chaque requête. Seul le point de la requête
est casté ; la colonne, jamais.

### Les vingt attributs que nous n'importons pas

Le flux publie 23 propriétés par tronçon. Quatre sont conservées, chacune parce
qu'elle change une décision (C5 — ne pas stocker ce qu'on n'interroge pas) :

| Colonne         | Source            | Pourquoi elle est gardée                                                      |
| --------------- | ----------------- | ----------------------------------------------------------------------------- |
| `name`          | `nom`             | affichage (« Rue Garibaldi »)                                                 |
| `facility_type` | `typeamenagement` | une piste séparée et une bande peinte n'ont pas la même sécurité (F2)         |
| `network`       | `reseau`          | distingue les axes express continus des dessertes de quartier                 |
| `surface`       | `revetementpiste` | **C12** : un stabilisé sablé n'est praticable ni en fauteuil ni par tout vélo |

`senscirculation`, `positionnement`, `financementac`, `anneelivraison`,
`observation` et les autres décrivent la gestion du patrimoine, pas le
déplacement.

## 4. L'import

```bash
cd apps/api
npm run db:import:cycle-paths              # ou : make cycle-import (depuis la racine)
npm run db:import:cycle-paths -- --dry-run # télécharge et filtre, n'écrit rien
```

```
[cycle-paths] Téléchargement du flux (data.grandlyon.com)…
[cycle-paths] 4714 entité(s) reçue(s).
[cycle-paths] 4067 tronçon(s) réalisé(s) retenu(s) après filtrage.
[cycle-paths] Import terminé : 4067 tronçon(s) écrit(s), 0 retiré(s).
[cycle-paths] Table cycle_paths : 4067 tronçon(s), 1124.4 km cumulés, 0 géométrie(s) invalide(s).
```

### Pourquoi un script Node et pas `ogr2ogr`

Le ticket évoque « ogr2ogr ou équivalent ». GDAL ferait le chargement en une
ligne, mais imposerait une dépendance système de plusieurs centaines de
mégaoctets, installée différemment sur chaque poste et sur la CI, pour charger
5 Mo de données. Le script utilise le client Prisma déjà présent et le `fetch`
du runtime : il tourne partout où le reste du projet tourne.

Il fait par ailleurs deux choses qu'`ogr2ogr` ne ferait pas seul — filtrer les
aménagements en projet, et réconcilier l'existant plutôt que vider la table.

### Idempotence et sûreté

- **Rejouable** : rapprochement sur `source_id` (`ON CONFLICT DO UPDATE`). Un
  tronçon corrigé est mis à jour, jamais dupliqué.
- **Réconcilié** : les tronçons absents de la nouvelle version du flux sont
  supprimés en fin de transaction, reconnaissables à leur `imported_at` resté en
  arrière. Un aménagement déclassé disparaît donc de la carte.
- **Transactionnel** : un flux tronqué en cours de téléchargement laisserait
  sinon une base à moitié peuplée, dans laquelle « aucune piste à proximité »
  serait un mensonge.
- **Refus de vider** : si le filtrage ne retient aucun tronçon (flux vide, WFS
  répondant du XML avec un code 200), le script s'interrompt **avant** d'écrire.
- **Par lots de 250** : un `INSERT` unique construirait un paramètre JSON de
  plusieurs mégaoctets, un `INSERT` par tronçon paierait 4 000 allers-retours.
- **Sans surface d'injection** (C4/OWASP A03) : le lot part en **un seul
  paramètre JSON** que PostgreSQL déplie (`jsonb_array_elements`). Le texte SQL
  est constant, bien que les libellés viennent d'une source externe.

## 5. L'API

```http
GET /api/transport/cycle-paths/nearby?lat=45.760515&lng=4.859057&radius=300&limit=3
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
      "geometry": { "type": "MultiLineString", "coordinates": [[[4.858743, 45.757074] /* … */]] },
    },
  ],
  "radiusMeters": 300,
  "datasetImportedAt": "2026-08-26T11:01:04.368Z",
}
```

| Paramètre | Défaut | Bornes  | Raison de la borne                                         |
| --------- | ------ | ------- | ---------------------------------------------------------- |
| `radius`  | 300 m  | 50–2000 | plancher = précision d'un GPS urbain (C6) ; plafond = C5   |
| `limit`   | 20     | 1–100   | chaque tracé pèse, sur réseau mobile plus qu'ailleurs (C5) |

### Trois points de contrat qui méritent une phrase

**La distance est celle du tronçon, pas de son début.** `ST_Distance` sur une
`geography(MultiLineString)` rend la distance au point **le plus proche** de la
ligne. Une Voie Lyonnaise de deux kilomètres qui passe devant la porte est donc à
quelques mètres — ce qu'une distance au point de départ ou au centroïde aurait
raté complètement.

**`lengthMeters` est la longueur totale du tronçon**, pas la portion comprise
dans le rayon : un tronçon peut légitimement être plus long que le rayon demandé.

**Il n'y a pas de champ `status`**, contrairement aux réponses GTFS et GBFS. Ces
deux-là décrivent des sources externes dont la panne doit être dégradée
gracieusement. Cet endpoint-ci n'a qu'un objet : les aménagements cyclables.
Rendre une liste vide parce que la base n'a pas répondu affirmerait qu'il n'y en
a pas ici — une réponse fausse, et indiscernable d'une réponse vraie. L'erreur
doit donc remonter en `500`, et se voir.

L'arbitrage vaut pour **cet** endpoint, pas pour le planificateur : là, l'usager
demande des itinéraires, et perdre les tronçons cyclables reste préférable à
perdre aussi les trajets en métro. Le Service Itinéraire dégrade donc cette même
source comme les deux autres (UF-305, `docs/source-orchestration.md`). Ce n'est
pas la source qui décide de l'arbitrage, c'est la question posée.

**`datasetImportedAt` sépare deux silences.** Un tableau `segments` vide avec une
date d'import signifie « pas d'aménagement cyclable ici » ; le même tableau avec
`datasetImportedAt: null` signifie « l'import n'a jamais été lancé ». Sans ce
champ, on conclurait à tort qu'un quartier n'est pas équipé.

### Normalisation des types d'aménagement (C9)

Les libellés du producteur sont projetés sur un vocabulaire commun front/back —
un libellé libre ne se pondère pas.

| Libellé source                            | Interne         |
| ----------------------------------------- | --------------- |
| `Piste Cyclable`                          | `CYCLE_TRACK`   |
| `Bande Cyclable`                          | `CYCLE_LANE`    |
| `Voie verte`                              | `GREENWAY`      |
| `Double sens cyclable`, `Vélorue`, `CVCB` | `SHARED_STREET` |
| `Couloir bus vélo élargi` / `non élargi`  | `BUS_LANE`      |
| `Goulotte ou rampe`                       | `CROSSING`      |
| libellé inconnu                           | `OTHER`         |

Un libellé inconnu devient `OTHER` plutôt que d'écarter le tronçon : à la
différence d'un **mode de transport** faux — qui fausserait le calcul carbone et
justifie d'écarter le trajet (cf. `otp.mapper`) —, un type d'aménagement inconnu
n'invalide pas l'aménagement. Le tronçon existe, il est cyclable, et le taire
appauvrirait la carte. Le libellé d'origine reste exposé en `sourceFacilityType`.

## 6. Recette du ticket

### Recette 1 — « La table de pistes cyclables est peuplée avec des géométries valides »

- [x] 4 067 tronçons importés, 1 124 km cumulés.
- [x] **0 géométrie invalide** — contrôlé par le script lui-même en fin d'import
      (`ST_IsValid`), pas seulement affirmé.

```bash
docker compose exec db psql -U urbanflow -d urbanflow -c "
  SELECT COUNT(*) AS total,
         COUNT(*) FILTER (WHERE NOT ST_IsValid(geom::geometry)) AS invalides,
         ROUND((SUM(ST_Length(geom))/1000)::numeric, 1) AS km,
         COUNT(DISTINCT ST_SRID(geom::geometry)) AS srids,
         MIN(ST_SRID(geom::geometry)) AS srid
  FROM cycle_paths;"
```

```
 total | invalides |   km   | srids | srid
-------+-----------+--------+-------+------
  4067 |         0 | 1124.4 |     1 | 4326
```

### Recette 2 — « ST_DWithin retourne les tronçons dans le rayon donné »

- [x] `GET /api/transport/cycle-paths/nearby?lat=45.760515&lng=4.859057&radius=300`
      renvoie les 15 tronçons autour de la Part-Dieu, triés par distance croissante.
- [x] Le rayon est bien **métrique**, et se comporte comme un rayon : le nombre
      de tronçons croît avec lui, sans jamais ramener le jeu de données entier —
      ce que ferait un rayon interprété en degrés (300° couvrent la planète).

      | `radius` | 50 m | 100 m | 300 m | 500 m | 1 000 m |
      | -------- | ---- | ----- | ----- | ----- | ------- |
      | Tronçons | 0    | 4     | 15    | 63    | 100 (plafond `limit`) |

- [x] Un point hors Métropole (Paris : `lat=48.8566&lng=2.3522`) renvoie `200` avec
      `segments: []` **et** une `datasetImportedAt` renseignée — « rien ici », pas
      « rien en base ».
- [x] Tests : `cycle-paths.service.spec.ts` (forme de la requête, ordre
      longitude/latitude, bornage) et `cycle-path.mapper.spec.ts` (normalisation).

Vérification directe en base :

```bash
docker compose exec db psql -U urbanflow -d urbanflow -c "
  SELECT ROUND(ST_Distance(geom, p.g))::int AS m, facility_type, name
  FROM cycle_paths,
       (SELECT ST_SetSRID(ST_MakePoint(4.859057, 45.760515), 4326)::geography AS g) p
  WHERE ST_DWithin(geom, p.g, 300)
  ORDER BY 1 LIMIT 5;"
```

### Recette 3 — « Un index spatial GiST existe (vérifiable, justifiable pour la perf C10) »

- [x] L'index existe et porte l'opclass des `geography` :

```bash
make cycle-check   # ou, directement :
docker compose exec db psql -U urbanflow -d urbanflow -c   "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'cycle_paths';"
```

```
         indexname         |                          indexdef
---------------------------+-----------------------------------------------------------
 cycle_paths_pkey          | ... USING btree (id)
 cycle_paths_source_id_key | ... USING btree (source_id)
 cycle_paths_geom_idx      | CREATE INDEX cycle_paths_geom_idx ON public.cycle_paths
                           |   USING gist (geom)
```

- [x] Il est **réellement utilisé** par la requête du service — le planificateur
      le choisit spontanément, sans hint :

```sql
EXPLAIN (ANALYZE, COSTS OFF)
SELECT source_id FROM cycle_paths
WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(4.859057,45.760515),4326)::geography, 300);
```

```
 Bitmap Heap Scan on cycle_paths (actual rows=15 loops=1)
   Filter: st_dwithin(geom, '…'::geography, '300'::double precision, true)
   Rows Removed by Filter: 31
   ->  Bitmap Index Scan on cycle_paths_geom_idx (actual rows=46 loops=1)
         Index Cond: (geom && _st_expand('…'::geography, '300'::double precision))
 Execution Time: 1.121 ms
```

L'index ramène **46 candidats sur 4 067** par boîtes englobantes ; le calcul de
distance ellipsoïdale exact ne porte que sur eux, et en écarte 31.

- [x] Le gain est mesuré, pas supposé. Même requête, index désactivé
      (`SET enable_bitmapscan=off; SET enable_indexscan=off;`) :

| Plan                             | Lignes examinées | Temps d'exécution |
| -------------------------------- | ---------------- | ----------------- |
| `Bitmap Index Scan` (index GiST) | 46               | **1,1 ms**        |
| `Seq Scan` (sans index)          | 4 067            | **50,6 ms**       |

**Environ 45× plus rapide**, à volume de développement. Le rapport se creuse avec
la taille de la table : le parcours séquentiel est linéaire, l'index ne l'est pas.

C'est aussi la raison pour laquelle le service écrit `ST_DWithin(geom, point,
radius)` et non `ST_Distance(geom, point) <= radius` : les deux formes donnent
les mêmes tronçons, mais seule la première est indexable. Un test le fige
(`cycle-paths.service.spec.ts`, « filters with ST_DWithin »), pour qu'une
réécriture bien intentionnée ne fasse pas retomber la requête en parcours
complet.

## 7. Exécuter les tests

```bash
cd apps/api && npx jest src/modules/transport/cycle-paths
```

Deux suites, **sans base ni réseau** (`$queryRaw` simulé) : elles vérifient la
forme de la requête et la projection des résultats. La vérification que la
requête est bien _indexée_ relève de l'`EXPLAIN` ci-dessus — un test unitaire ne
peut pas le prouver.

## 8. Contraintes couvertes

| Contrainte | Traduction dans cette fonctionnalité                                                             |
| ---------- | ------------------------------------------------------------------------------------------------ |
| C4         | Paramètres liés (`$queryRaw`, lot JSON unique), validation DTO + revalidation service, bornes    |
| C5         | 4 attributs sur 23 importés, rayon et volume plafonnés, GeoJSON à 6 décimales, données hébergées |
| C6         | Rayon plancher à 50 m, aligné sur la précision réelle d'un GPS urbain                            |
| C8         | Aucune donnée personnelle : patrimoine public sous Licence Ouverte                               |
| C9         | WFS/GeoJSON standard, SRID 4326, types d'aménagement normalisés, contrats partagés front/back    |
| C10        | Index GiST mesuré (45×), lectures parallélisées, source hébergée hors du chemin réseau critique  |
| C11        | Les logs comptent les tronçons, ils ne journalisent jamais la position interrogée                |
| C12        | Revêtement exposé — un stabilisé sablé n'est praticable ni en fauteuil ni par tous les vélos     |

## 9. Références

- Jeu de données : <https://data.grandlyon.com/portail/fr/jeux-de-donnees/amenagements-cyclables-metropole-lyon>
- `ST_DWithin` : <https://postgis.net/docs/ST_DWithin.html>
- `geography` vs `geometry` : <https://postgis.net/docs/using_postgis_dbmanagement.html#PostGIS_Geography>
- Index GiST PostGIS : <https://postgis.net/docs/using_postgis_dbmanagement.html#idm2246>
