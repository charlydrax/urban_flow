# Module `search-history` — Historique de recherche (UF-204)

## Rôle

Persiste chaque recherche d'itinéraire du compte connecté — **étape 18 de la
séquence de référence** (`INSERT search_history`) — et sert les dernières
recherches au planificateur, qui les affiche sous les champs de saisie sous forme
de rappels recliquables.

Deux usages en découlent :

- **immédiat** : rejouer un trajet fréquent en un clic (F2) ;
- **à venir** : le tableau de bord des habitudes de mobilité et l'agrégation
  carbone, qui liront ces mêmes lignes.

## Endpoints (tous protégés par le guard JWT global)

| Méthode | Route                         | Description                          |
| ------- | ----------------------------- | ------------------------------------ |
| POST    | `/api/search-history`         | Enregistre une recherche             |
| GET     | `/api/search-history?limit=N` | Les N dernières recherches du compte |

### `POST /api/search-history`

```json
{
  "from": { "label": "Gare Part-Dieu, 69003 Lyon", "lat": 45.7605, "lng": 4.8596 },
  "to": { "label": "Place Bellecour, 69002 Lyon", "lat": 45.7578, "lng": 4.832 },
  "selectedSummary": "Marche + Métro B",
  "carbonGrams": 14
}
```

`selectedSummary` et `carbonGrams` sont **facultatifs** : la recherche est
enregistrée dès sa soumission, donc avant que l'utilisateur n'ait choisi une
option. Les coordonnées, elles, sont **obligatoires** — voir plus bas.

Réponses : `201` (l'entrée créée, relue depuis les colonnes géométriques),
`400` (coordonnées absentes ou hors bornes WGS84, clé inconnue), `401`.

### `GET /api/search-history`

```json
{
  "entries": [
    {
      "id": "…",
      "from": { "label": "Gare Part-Dieu, 69003 Lyon", "lat": 45.7605, "lng": 4.8596 },
      "to": { "label": "Place Bellecour, 69002 Lyon", "lat": 45.7578, "lng": 4.832 },
      "selectedSummary": null,
      "carbonGrams": null,
      "createdAt": "2026-07-31T09:12:00.000Z"
    }
  ]
}
```

`limit` : 1 à 20, **5 par défaut**. La borne haute empêche une requête unique de
balayer tout un historique et d'en faire transiter le poids sur un réseau mobile
(C5, C10).

**Un même trajet n'apparaît qu'une fois** : la requête applique un
`DISTINCT ON (from_label, to_label)` et garde l'occurrence la plus récente.
Chercher trois fois « Part-Dieu → Bellecour » remplirait sinon toute la liste de
rappels d'une seule ligne. La base conserve bien les trois lignes — c'est
l'affichage qui les replie, et le tableau de bord carbone aura besoin du détail.

## Stockage PostGIS

Les extrémités sont des `geometry(Point, 4326)` (WGS84), pas deux colonnes
flottantes ni du texte :

```sql
from_geom geometry(Point,4326) NOT NULL
to_geom   geometry(Point,4326) NOT NULL
CREATE INDEX search_history_from_geom_idx ON search_history USING GIST (from_geom);
```

L'index GiST est ce qui rend le choix du type payant : sans lui, `geometry`
n'aurait été qu'un nom mieux choisi pour deux flottants. Il rend indexables les
requêtes de proximité à venir (« mes trajets récents partant d'ici »,
`ST_DWithin`), comme à l'étape 4 du flux de référence pour les pistes cyclables.

Conséquence pratique : **Prisma ne sait pas manipuler `geometry`** (le schéma les
déclare `Unsupported`). Le service passe donc par `$queryRaw`, avec
`ST_SetSRID(ST_MakePoint(lng, lat), 4326)` à l'écriture et `ST_X`/`ST_Y` à la
lecture. Le format PostGIS reste ainsi un détail de stockage : rien d'autre dans
l'application ne voit passer de WKB.

> ⚠️ `ST_MakePoint` prend **(X, Y) = (longitude, latitude)**, l'inverse de
> l'ordre d'écriture usuel. Une inversion enverrait tous les trajets lyonnais au
> large de la Somalie, sans lever la moindre erreur — d'où un test dédié.

Puisque les colonnes sont `NOT NULL`, un trajet sans coordonnées est refusé à
l'entrée par le DTO (`400`) plutôt que par la base (`500`). Le front n'envoie de
toute façon que des adresses réellement géocodées (UF-203).

## Isolation des historiques (OWASP A01)

Aucune route n'accepte d'identifiant de compte : ni en chemin, ni en query, ni
dans le corps. L'auteur d'une ligne et le périmètre d'une lecture sont
**toujours** le porteur du JWT vérifié (`@CurrentUser`). Un `userId` glissé dans
le corps est rejeté en `400` par le `ValidationPipe` global
(`forbidNonWhitelisted`). Le service n'expose délibérément aucune méthode
« lire l'historique de X » — recette 2 du ticket.

**Injection SQL (OWASP A03)** : le SQL brut est écrit en _tagged template_
`$queryRaw`, où chaque `${…}` devient un paramètre lié côté PostgreSQL. Aucune
valeur venant du client n'est concaténée dans le texte de la requête ; un test
le vérifie explicitement.

## Dépendances

- `PrismaService` — table `search_history` via `$queryRaw` (géométries PostGIS)
- `@CurrentUser()` — identité issue du JWT (jamais du corps — C4)
- `@urbanflow/shared` — contrats `SearchHistoryEntry`,
  `CreateSearchHistoryPayload`, bornes `DEFAULT/MAX_SEARCH_HISTORY_LIMIT` (C9)

## Contraintes couvertes

| Contrainte | Traduction dans le module                                                                 |
| ---------- | ----------------------------------------------------------------------------------------- |
| C4         | DTO stricts, requêtes paramétrées, identité issue du token, aucune route paramétrée       |
| C5 / C10   | `limit` borné, dédoublonnage à la lecture, réponse rendue à la création (un aller-retour) |
| C6         | Coordonnées WGS84 obligatoires, issues de la géolocalisation ou du géocodage              |
| C8         | Trajets cloisonnés au propriétaire, purge en cascade avec le compte                       |
| C9         | Géométries SRID 4326 standard, dates ISO 8601, contrat partagé, Swagger                   |
| C11        | Aucune donnée de déplacement journalisée                                                  |

## Tests

- `search-history.service.spec.ts` — rattachement au compte du token, périmètre
  de lecture verrouillé (recette 2), écriture en géométrie SRID 4326 avec l'ordre
  (lng, lat) (recette 3), paramétrage des valeurs client, plafonnement du
  `limit`, dédoublonnage des trajets répétés.

## Reste à faire (hors UF-204)

- Écriture depuis le planificateur lui-même (étape 18 du flux) : le service est
  exporté et prêt, `RoutesService` l'appellera quand le calcul réel arrivera.
- Agrégation par le tableau de bord carbone (`CarbonService.getDashboard`,
  encore stub).
- **Politique de rétention** (C8/C11) : les trajets ne devraient pas être
  conservés indéfiniment. Purge au-delà de N mois + suppression manuelle d'une
  entrée à exposer — la cascade avec le compte est en place, pas la durée de vie.
