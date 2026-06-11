# @urbanflow/shared

Types TypeScript **partagés** entre le front (`apps/web`) et le back (`apps/api`) :
contrats d'API (DTO d'itinéraires, auth, carbone) et vocabulaire commun
(`TransportMode`). Une seule définition du contrat front/back (interopérabilité — C9).

## Contenu

| Fichier                 | Exports                                                                                              | Utilisé par                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/transport-mode.ts` | enum `TransportMode`                                                                                 | DTO API, préférences, facteurs CO₂                                                          |
| `src/route.ts`          | `Place`, `PlanRouteRequest`, `RouteSegment`, `Itinerary`, `PlanRoutesResponse`, `LineStringGeometry` | planificateur F2 (les DTO NestJS _implémentent_ ces interfaces, le client web les consomme) |
| `src/auth.ts`           | `AuthResponse`                                                                                       | auth F1                                                                                     |
| `src/carbon.ts`         | `CarbonDashboard`                                                                                    | suivi carbone                                                                               |

## Utilisation

```ts
import { Itinerary, TransportMode } from '@urbanflow/shared';
```

Le package est compilé vers `dist/` (JS + déclarations `.d.ts`) :

- `npm install` à la racine le compile automatiquement (script `prepare`) ;
- après modification d'un type : `npm run build --workspace packages/shared`
  (ou `npm run dev --workspace packages/shared` pour le mode watch).

## Règle de conception

Ce package ne contient **que des types et constantes pures** (pas de dépendance
NestJS/Next.js, pas de logique métier) afin de rester importable des deux côtés
sans alourdir le bundle client (éco-conception — C5).
