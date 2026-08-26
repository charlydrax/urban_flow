# Module `routes` — Planificateur multimodal (F2)

## Rôle

« Service Itinéraire » de l'architecture logique : calcule les itinéraires multimodaux
(TC + mobilités douces), orchestré selon le diagramme de séquence du MVP
(CLAUDE.md section 4).

## Endpoints (protégés par le guard JWT global)

| Méthode | Route              | Description                                                   | Statut                            |
| ------- | ------------------ | ------------------------------------------------------------- | --------------------------------- |
| POST    | `/api/routes/plan` | Itinéraires multimodaux + CO₂, triés par empreinte croissante | stub (mock Part-Dieu → Bellecour) |

Contrat d'entrée : `{ from: {label, lat?, lng?}, to: {...}, userId }` — `userId` est
supplanté par l'identité du JWT (anti-IDOR, C4).

## Implémentation cible (résumé du flux)

1. Préférences profil (PostGIS) → 2. `Promise.all` GTFS + GBFS + `ST_DWithin` (C10)
   → 3. fusion multimodale (404 si vide) → 4. `computeFootprint` par itinéraire
   → 5. sauvegarde `search_history` → 6. réponse triée par CO₂ croissant.
   Dégradation gracieuse : API externe HS → mode ignoré, autres options retournées.

## Dépendances

- `TransportModule` — les **trois** sources de l'étape 2 : `TransitService` (GTFS,
  UF-302), `SharedMobilityService` (GBFS, UF-303) et `CyclePathsService`
  (`ST_DWithin` sur PostGIS, UF-304)
- `UsersModule` (préférences), `CarbonModule` (CO₂)
- `PrismaService` (`SearchHistory` via `$queryRaw`)

## Contraintes couvertes

C4 (validation, anti-IDOR), C9 (GeoJSON LineString), C10 (appels parallèles,
dégradation gracieuse), C12 (champ `accessible` PMR).
