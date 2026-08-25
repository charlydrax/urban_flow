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

## Moteur de routage transports en commun

Le volet GTFS ne s'appuie pas sur une API tierce mais sur une instance
**OpenTripPlanner auto-hébergée**, mise en place en UF-301 :

- service `otp` du `docker-compose.yml`, API GraphQL sur `http://localhost:8080/otp/gtfs/v1` ;
- graphe construit à partir du GTFS TCL et du réseau OSM lyonnais ;
- installation, test et procédure de mise à jour mensuelle : [`docs/otp-gtfs.md`](../../../../../docs/otp-gtfs.md).

`findTransitOptions(from, to)` interrogera cette instance (ticket UF-302).

## Dépendances

Aucune pour l'instant (HTTP client vers OpenTripPlanner et les flux GBFS lors de F3).

## Contraintes couvertes

C9 (formats standards GTFS/GBFS), C10 (résilience, pas de polling inutile — cache prévu, C5).
