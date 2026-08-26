# GBFS Vélo'v — connecteur mobilités douces (UF-303)

Source de données des vélos et trottinettes en libre-service du MVP, et recette
du ticket UF-303. Complète [`otp-gtfs.md`](./otp-gtfs.md), qui couvre le volet
transports en commun.

---

## 1. Ce que GBFS apporte au produit

**GBFS** (_General Bikeshare Feed Specification_) est le format ouvert standard
des opérateurs de véhicules partagés — l'équivalent de GTFS pour les vélos. Il
est maintenu par MobilityData et adopté par la quasi-totalité des réseaux
européens.

Le choisir plutôt que l'API propriétaire d'un opérateur est un choix
d'interopérabilité (C9) : le même connecteur lira demain le flux d'un opérateur
de trottinettes ou d'une autre métropole, sans réécriture.

C'est la seconde des deux sources de F3, et l'une des trois branches du
`Promise.all` du Service Itinéraire (étapes 10-11 du flux de référence).

## 2. La source retenue

|                      |                                                                                   |
| -------------------- | --------------------------------------------------------------------------------- |
| **Réseau**           | Vélo'v — Métropole de Lyon, exploité par JCDecaux                                 |
| **Auto-découverte**  | `https://download.data.grandlyon.com/files/rdata/jcd_jcdecaux.jcdvelov/gbfs.json` |
| **Version GBFS**     | 2.3                                                                               |
| **Authentification** | aucune — flux public                                                              |
| **Licence**          | Licence Ouverte (JCDecaux / Grand Lyon)                                           |
| **Volume**           | ~450 stations, flotte mécanique + électrique                                      |

### Pourquoi ce miroir, et pas l'API JCDecaux

L'API développeur de JCDecaux (`api.jcdecaux.com`) exige une clé et répond
**HTTP 403** sans elle. Le portail open data de la Métropole republie le même
contenu au format GBFS, **sans clé**. Deux avantages : aucun secret à gérer pour
un flux public, et un format standard plutôt que propriétaire.

Contrairement au GTFS TCL (cf. `otp-gtfs.md`), **ce flux est bien vivant** : les
disponibilités sont réelles et à jour. Aucun recalage de date n'est nécessaire
ici.

### Les flux consommés

Le connecteur ne connaît que l'URL de `gbfs.json`, et y lit les autres :

| Flux                  | Contenu                                    | Cache            |
| --------------------- | ------------------------------------------ | ---------------- |
| `station_information` | position, nom, adresse, capacité           | 1 h              |
| `station_status`      | vélos et bornettes disponibles, temps réel | 1 min (réglable) |
| `vehicle_types`       | facteur de forme et motorisation           | 1 h              |

`system_information` n'est **pas** consommé : son contenu (nom commercial,
conditions générales, URL de l'application) ne sert à rien au calcul
d'itinéraire, et chaque flux non lu est une requête réseau en moins (C5).

## 3. Configuration

Dans `apps/api/.env` (modèle dans `.env.example`) :

```dotenv
GBFS_DISCOVERY_URL=https://download.data.grandlyon.com/files/rdata/jcd_jcdecaux.jcdvelov/gbfs.json
GBFS_TIMEOUT_MS=5000
GBFS_STATUS_TTL_MS=60000
```

Ces trois variables sont **obligatoires** : l'API refuse de démarrer si l'une
manque ou sort de ses bornes (fail-fast, C4). Aucune ne contient de secret — le
flux est public — elles peuvent donc figurer telles quelles dans le dépôt via
`.env.example`.

Changer d'opérateur ou de ville ne demande que de remplacer
`GBFS_DISCOVERY_URL`.

## 4. Vérifier la source à la main

```bash
# Le document d'auto-découverte : quels flux l'opérateur publie-t-il ?
curl -s https://download.data.grandlyon.com/files/rdata/jcd_jcdecaux.jcdvelov/gbfs.json

# La disponibilité temps réel (extrait)
curl -s https://download.data.grandlyon.com/files/rdata/jcd_jcdecaux.jcdvelov/station_status.json | head -c 600
```

Le champ `last_updated` (secondes epoch) donne l'heure de publication : c'est ce
que l'API réexpose en ISO 8601 dans `publishedAt`.

## 5. L'endpoint

```
GET /api/transport/stations/nearby?lat=45.760515&lng=4.859057&radius=500&limit=10
```

Protégé par le guard JWT global. Documenté dans Swagger
(`http://localhost:3001/api/docs`, section **transport**).

| Paramètre | Obligatoire | Bornes      | Défaut |
| --------- | ----------- | ----------- | ------ |
| `lat`     | oui         | WGS84       | —      |
| `lng`     | oui         | WGS84       | —      |
| `radius`  | non         | 50 – 2000 m | 500    |
| `limit`   | non         | 1 – 50      | 10     |

Le détail du contrat de réponse, des choix de cache et des stations écartées est
documenté dans le [README du module
`transport`](../apps/api/src/modules/transport/README.md).

## 6. Recette du ticket UF-303

### Recette 1 — « `getNearbyStations` retourne les stations proches d'un point avec le nombre de vélos dispo »

- [x] `GET /api/transport/stations/nearby?lat=45.760515&lng=4.859057` renvoie les
      stations Vélo'v autour de la Part-Dieu, **triées par distance croissante**,
      chacune avec `vehiclesAvailable`, `docksAvailable` et sa ventilation
      mécanique / électrique.
- [x] Tests : `gbfs.mapper.spec.ts` (croisement des flux, tri, bornage) et
      `shared-mobility.service.spec.ts` (recette 1).

### Recette 2 — « Les données sont fraîches (statut temps réel, pas figé) »

- [x] `station_status` est relu au plus toutes les `GBFS_STATUS_TTL_MS`
      (1 minute par défaut) — les autres flux, quasi statiques, tiennent une heure.
- [x] La réponse porte `publishedAt`, l'horodatage **de l'opérateur** : rafraîchir
      la requête après une minute le fait avancer.
- [x] Chaque station porte en plus son `lastReportedAt` : une borne muette depuis
      des heures se distingue d'un flux périmé.
- [x] `GET /api/transport/status` contourne le cache et déclare la source
      `degraded` au-delà d'un quart d'heure sans republication.
- [x] Tests : `gbfs.client.spec.ts` (TTL, dédoublonnage, contournement par la
      sonde) et `shared-mobility.service.spec.ts` (recette 2).

### Recette 3 — « Une indisponibilité du flux GBFS ne fait pas planter le service »

- [x] Timeout, opérateur injoignable, HTTP 5xx, corps illisible, flux retiré :
      tous rendent `200 OK` avec `status: 'unavailable'` et une
      `unavailableReason` qualifiée — jamais d'exception.
- [x] Une erreur inattendue (bug interne) est traitée de la même façon : le
      planificateur reste debout quoi qu'il arrive à cette source (C10).
- [x] Un échec n'est jamais mis en cache : la source est réessayée au coup suivant.
- [x] Tests : `gbfs.client.spec.ts` et `shared-mobility.service.spec.ts` (recette 3).

### Vérification manuelle de la recette 3

```bash
# Pointer la configuration vers un hôte qui n'existe pas, puis redémarrer l'API
GBFS_DISCOVERY_URL=http://127.0.0.1:9/gbfs.json
```

`GET /api/transport/stations/nearby` répond alors `200 OK` avec
`{"status":"unavailable","unavailableReason":"network","stations":[]}`, et
`GET /api/transport/status` montre `gbfs` en `down` — pendant que la source
`gtfs` reste `ok`. C'est exactement la dégradation gracieuse attendue.

## 7. Exécuter les tests

```bash
cd apps/api && npx jest src/modules/transport
```

Aucun accès réseau : `fetch` est simulé, les jeux d'essai reprennent la forme
réelle du flux Vélo'v (identifiants `mechanical` / `electrical`, GBFS 2.3).

## 8. Contraintes couvertes

| Contrainte | Traduction dans ce connecteur                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------ |
| C4         | Validation DTO + revalidation service, bornes sur rayon et limite, aucun secret en configuration |
| C5         | Cache gradué par volatilité, dédoublonnage des requêtes, appels parallèles, volumes plafonnés    |
| C6         | Rayon plancher à 50 m, aligné sur la précision réelle d'un GPS urbain                            |
| C9         | GBFS standard consommé par son auto-découverte, contrats internes partagés front/back            |
| C10        | Timeouts bornés, dégradation gracieuse, `degraded` sur flux figé                                 |
| C11        | Aucune position ni station journalisée, aucun en-tête d'identification envoyé                    |

## 9. Références

- Spécification GBFS : <https://github.com/MobilityData/gbfs/blob/master/gbfs.md>
- Catalogue des flux GBFS : <https://github.com/MobilityData/gbfs/blob/master/systems.csv>
- Portail open data de la Métropole de Lyon : <https://data.grandlyon.com/>
