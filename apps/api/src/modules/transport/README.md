# Module `transport` — Intégrations GTFS / GBFS (F3)

## Rôle

Adaptateur vers les sources de données transport aux formats standards (C9) :

- **GTFS** : transports en commun (arrêts, lignes, horaires)
- **GBFS** : vélos et trottinettes en libre-service (stations, disponibilité)

Consommé par le Service Itinéraire (module `routes`) via des appels parallèles (C10).

## Endpoints (protégés par le guard JWT global)

| Méthode | Route                   | Description                | Statut |
| ------- | ----------------------- | -------------------------- | ------ |
| GET     | `/api/transport/status` | État des sources GTFS/GBFS | stub   |

## Implémentation cible

- `findTransitOptions(from, to)` (GTFS) et `findSharedMobilityNear(point)` (GBFS).
- Dégradation gracieuse : source indisponible → mode ignoré, jamais d'erreur bloquante (C10).

## Dépendances

Aucune pour l'instant (HTTP client vers les flux ouverts lors de F3).

## Contraintes couvertes

C9 (formats standards GTFS/GBFS), C10 (résilience, pas de polling inutile — cache prévu, C5).
