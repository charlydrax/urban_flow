# Module `carbon` — Calculateur d'empreinte carbone (fonctionnalité retenue)

## Rôle

« Service Carbone » de l'architecture logique :

- calcul du CO₂ **par segment** d'itinéraire (`computeFootprint`), appelé par le
  Service Itinéraire à l'étape 6 du flux de référence ;
- **tableau de bord personnel** : historique et impact des déplacements.

## Endpoints (protégés par le guard JWT global)

| Méthode | Route                   | Description                             | Statut |
| ------- | ----------------------- | --------------------------------------- | ------ |
| GET     | `/api/carbon/dashboard` | CO₂ émis/évité + trajets sur la période | stub   |

## Implémentation cible

- Facteurs d'émission par mode (g CO₂/passager·km, source ADEME) × distance.
- Agrégation de `SearchHistory` (PostGIS) pour le tableau de bord.

## Dépendances

- `PrismaService` (`SearchHistory`) — branché lors de l'implémentation.
- Consommé par `RoutesModule`.

## Contraintes couvertes

Proposition de valeur écologique (tri CO₂ croissant) ; C8 (l'utilisateur ne voit
que ses données) ; C5 (calcul côté serveur, pas de recalcul client inutile).
