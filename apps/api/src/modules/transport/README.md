# Module `transport` — Intégrations GTFS / GBFS (F3)

## Rôle

Adaptateur vers les sources de données transport aux formats standards (C9) :

- **GTFS** : transports en commun (arrêts, lignes, horaires) — **implémenté** (UF-302)
- **GBFS** : vélos et trottinettes en libre-service (stations, disponibilité) — stub (UF-303)

Consommé par le Service Itinéraire (module `routes`) via des appels parallèles (C10).

## Endpoints (protégés par le guard JWT global)

| Méthode | Route                   | Description                | Statut                            |
| ------- | ----------------------- | -------------------------- | --------------------------------- |
| GET     | `/api/transport/status` | État des sources GTFS/GBFS | GTFS réellement sondé ; GBFS stub |

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
├── transit.service.ts      orchestration : date de service, requête, normalisation
├── transport.service.ts    état des sources (bandeau « mode dégradé » côté front)
└── otp/
    ├── otp.client.ts       transport HTTP + timeout + qualification des pannes
    ├── otp.mapper.ts       OTP -> contrats internes (fonctions pures)
    ├── otp.types.ts        forme brute des réponses GraphQL d'OTP
    └── service-date.ts     fuseau du réseau + recalage sur la période du graphe
```

La frontière tient en une règle : **rien de la structure d'OTP ne franchit le
dossier `otp/`**. Remplacer le moteur de routage (OTP 3, Navitia, API opérateur)
n'imposerait de réécrire que le client et le mapper.

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

## Configuration

| Variable         | Rôle                                       | Défaut                  |
| ---------------- | ------------------------------------------ | ----------------------- |
| `OTP_BASE_URL`   | Racine du service OpenTripPlanner          | `http://localhost:8080` |
| `OTP_TIMEOUT_MS` | Délai maximal accordé au moteur (1 s–30 s) | `12000`                 |

Validées au démarrage : l'API refuse de démarrer si elles manquent (fail-fast, C4).

Le défaut de 12 s vient de la mesure : sur le graphe lyonnais en développement,
une requête `plan` prend de 1,7 s à 8,3 s selon la charge de la machine et selon
que la journée d'exploitation demandée est déjà en cache côté OTP. Une instance
correctement dimensionnée répond bien en deçà — d'où le réglage par variable.

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

## Sécurité (C4/C11)

- Les paramètres passent par les **variables GraphQL**, jamais par concaténation
  dans le document : pas de surface d'injection.
- Les coordonnées sont revalidées avant appel (défense en profondeur).
- Les logs comptent les trajets, ils n'en journalisent jamais le détail : un
  itinéraire est une donnée de déplacement.

## Dépendances

- `OtpClient` (interne au module) → OpenTripPlanner, API GraphQL `/otp/gtfs/v1`
- `@urbanflow/shared` pour les contrats `TransitJourney` / `TransitJourneysResult`

## Tests

```bash
cd apps/api && npx jest src/modules/transport
```

Quatre suites, sans réseau ni conteneur (`fetch` simulé) : mapper, client,
calendrier de service, service. Recette du ticket UF-302 dans
[`docs/otp-gtfs.md`](../../../../../docs/otp-gtfs.md), section 10.

## Contraintes couvertes

C4 (variables GraphQL, revalidation des entrées), C5 (mémoïsation, champs
minimaux), C9 (GTFS/GeoJSON, contrats partagés), C10 (timeout borné, dégradation
gracieuse), C11 (logs sans donnée de déplacement), C12 (accessibilité PMR).
