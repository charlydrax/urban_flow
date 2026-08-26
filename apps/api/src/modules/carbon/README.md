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

## Barème d'émission (UF-401)

`emission-factors.ts` porte les facteurs en **g CO₂e par passager et par
kilomètre**, ordres de grandeur de la Base Empreinte de l'ADEME pour un réseau
urbain français :

| Mode      | g CO₂e/p.km | Pourquoi cette valeur                                           |
| --------- | ----------- | --------------------------------------------------------------- |
| `WALK`    | 0           | aucune émission attribuable au déplacement                      |
| `BIKE`    | 2           | nul à l'usage ; reste la régulation par camion du libre-service |
| `TRAM`    | 3           | traction électrique, mix français très décarboné                |
| `METRO`   | 4           | même traction, charge moyenne un peu plus élevée                |
| `SCOOTER` | 25          | dominé par la fabrication amortie sur une durée de vie courte   |
| `CARPOOL` | 88          | voiture moyenne rapportée à un remplissage de 2,5               |
| `BUS`     | 95          | autobus thermique au taux d'occupation moyen d'une métropole    |

### Deux choix qui méritent d'être dits

**Ce sont des fonctions pures, pas des méthodes du service.** La fusion
multimodale (UF-401) doit valoriser chaque segment qu'elle construit, et c'est
une fonction sans dépendance : lui faire injecter un service NestJS pour une
multiplication compliquerait ses tests sans rien apporter.

**`computeFootprint` recalcule au lieu de sommer.** Il ignore le `carbonGrams`
que porte un segment et le rederive de son mode et de sa distance. Un segment
fabriqué par la fusion et un segment venu d'ailleurs sont ainsi valorisés au même
barème, et une valeur fantaisiste ne peut pas se glisser dans le total publié.

### Ce que le barème n'est pas

Un ordre de grandeur, pas une comptabilité carbone certifiée. Il **classe**
correctement les modes entre eux — c'est ce dont le tri par empreinte croissante
a besoin. Un ticket dédié affinera : taux d'occupation réels des lignes TCL, mix
électrique horaire, distinction vélo mécanique / VAE par station. Les valeurs
sont regroupées dans un seul fichier précisément pour que cet affinage n'ait
qu'un endroit à toucher.

## Reste à faire

- Agrégation de `SearchHistory` (PostGIS) pour le tableau de bord (aujourd'hui un
  stub à valeurs figées).
- CO₂ **évité** par rapport à un trajet tout-voiture équivalent.

## Dépendances

- `PrismaService` (`SearchHistory`) — branché lors de l'implémentation du
  tableau de bord.
- Consommé par `RoutesModule` (étape 6 du flux) et par `merge/itinerary-merger.ts`
  via les facteurs d'émission.

## Tests

```bash
cd apps/api && npx jest src/modules/carbon
```

`emission-factors.spec.ts` fige le **classement** des modes, pas les valeurs : un
affinage du barème est attendu, mais il ne doit jamais retourner l'ordre sans que
le test le signale.

## Contraintes couvertes

Proposition de valeur écologique (tri CO₂ croissant) ; C8 (l'utilisateur ne voit
que ses données) ; C5 (calcul côté serveur, pas de recalcul client inutile).
