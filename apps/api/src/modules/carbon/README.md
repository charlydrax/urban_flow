# Module `carbon` — Calculateur d'empreinte carbone (fonctionnalité retenue)

## Rôle

« Service Carbone » de l'architecture logique :

- calcul du CO₂ **par segment** d'itinéraire (`computeFootprint`), appelé par le
  Service Itinéraire à l'étape 6 du flux de référence (étapes 16-17 de la
  séquence détaillée) ;
- **tableau de bord personnel** : historique et impact des déplacements.

## Endpoints (protégés par le guard JWT global)

| Méthode | Route                                | Description                                             |
| ------- | ------------------------------------ | ------------------------------------------------------- |
| GET     | `/api/carbon/summary?days=7\|30\|90` | Suivi personnel : totaux, évolution, série du graphique |

> `GET /api/carbon/dashboard` a été **retiré** par UF-505. C'était un stub à
> valeurs figées, sans lecture en base et sans autre appelant que le squelette
> d'écran remplacé par le même ticket : le laisser au contrat public aurait
> signifié publier une route qui ment.

## `computeFootprint(segments)` — total **et** détail (UF-501)

```ts
computeFootprint(segments) → {
  totalGrams: 392,                    // somme exacte des lignes ci-dessous
  segments: [
    { mode: 'WALK', distanceMeters: 400,  factorGramsPerKm: 0,  grams: 0   },
    { mode: 'BUS',  distanceMeters: 4000, factorGramsPerKm: 95, grams: 380 },
    { mode: 'WALK', distanceMeters: 300,  factorGramsPerKm: 0,  grams: 0   },
  ],
  carEquivalentGrams: 1024,           // la même distance, seul en voiture
  avoidedGrams: 632,                  // jamais négatif
}
```

Trois décisions à défendre :

**Un objet, pas un nombre.** Le service rendait un total seul jusqu'à ce ticket.
« 392 g » ne dit pas que 380 viennent des quatre kilomètres de bus, et c'est
pourtant la seule information sur laquelle l'usager peut agir. Le détail est
aussi ce qui rend le chiffre **vérifiable** : chaque ligne porte le facteur qui
l'a produite, donc se refait de tête.

**Le total est la somme des lignes publiées, jamais un calcul parallèle.**
Arrondir segment par segment puis sommer ne donne pas le même nombre que sommer
puis arrondir. Un total qui ne serait pas celui des lignes affichées serait une
erreur visible à l'écran.

**La correspondance avec `Itinerary.segments` est positionnelle.** Le détail ne
répète ni les libellés ni les horaires du segment : il les laisse là où ils sont
déjà (C5). Les deux tableaux sortent du même parcours, l'ordre est donc garanti
par construction — et documenté dans le contrat partagé.

## Barème d'émission

`emission-factors.ts` porte les facteurs en **g CO₂e par passager et par
kilomètre**.

**Source** : Base Empreinte® de l'ADEME (ex-Base Carbone®), poste « Transport de
personnes » — <https://base-empreinte.ademe.fr>. Les valeurs sont des arrondis
des ordres de grandeur publiés pour un réseau urbain français, pas des
extractions ligne à ligne.

**Méthodologie** : unité par **passager** (seule façon de comparer un bus rempli
à une voiture avec un conducteur seul) ; périmètre « usage + amont énergie »,
fabrication et infrastructure exclues _sauf_ pour les mobilités partagées où
elles dominent ; taux d'occupation moyens de réseau, 2,5 pour le covoiturage, 1
pour la référence voiture ; mix électrique français moyen ; calcul
`grammes = facteur × distance_km` arrondi au gramme, sans pondération de durée,
de dénivelé ni de charge instantanée — la distance est la seule variable dont le
planificateur dispose pour tous les modes.

| Mode      | g CO₂e/p.km | Pourquoi cette valeur                                           |
| --------- | ----------- | --------------------------------------------------------------- |
| `WALK`    | 0           | aucune émission attribuable au déplacement                      |
| `BIKE`    | 2           | nul à l'usage ; reste la régulation par camion du libre-service |
| `TRAM`    | 3           | traction électrique, mix français très décarboné                |
| `METRO`   | 4           | même traction, charge moyenne un peu plus élevée                |
| `SCOOTER` | 25          | dominé par la fabrication amortie sur une durée de vie courte   |
| `CARPOOL` | 88          | la référence voiture rapportée à un remplissage de 2,5          |
| `BUS`     | 95          | autobus thermique au taux d'occupation moyen d'une métropole    |

### La référence voiture (UF-501)

`CAR_REFERENCE_GRAMS_PER_KM = 218` — voiture particulière moyenne, **seul à
bord**. Volontairement **hors** de `GRAMS_PER_PASSENGER_KM` : ce tableau est
indexé par `TransportMode`, et y ajouter la voiture solo obligerait à créer un
mode que ni la fusion, ni la carte, ni le formulaire ne savent produire.
UrbanFlow ne propose pas de conduire seul ; il montre ce que cela aurait coûté.

Un gramme ne parle à personne dans l'absolu : « 392 g » ne devient lisible qu'en
face du « 1,0 kg » de l'alternative que l'usager a renoncé à prendre. C'est cette
comparaison qui porte la proposition de valeur écologique du produit, et c'est
elle que l'écran de résultats affiche sous l'itinéraire retenu.

Le covoiturage en dérive (218 / 2,5 ≈ 88) et un test fige ce lien : faire évoluer
les deux valeurs indépendamment finirait par produire un covoiturage plus
émetteur que la voiture qu'il remplit.

### Deux choix qui méritent d'être dits

**Ce sont des fonctions pures, pas des méthodes du service.** La fusion
multimodale (UF-401) doit valoriser chaque segment qu'elle construit, et c'est
une fonction sans dépendance : lui faire injecter un service NestJS pour une
multiplication compliquerait ses tests sans rien apporter.

**`computeFootprint` recalcule au lieu de sommer.** Il ignore le `carbonGrams`
que porte un segment et le rederive de son mode et de sa distance. Un segment
fabriqué par la fusion et un segment venu d'ailleurs sont ainsi valorisés au même
barème, et une valeur fantaisiste ne peut pas se glisser dans le total publié.
Depuis UF-501, le Service Itinéraire **réécrit** les `carbonGrams` des segments
publiés avec les lignes du détail : deux chiffres pour la même chose à l'écran,
l'un du service et l'autre de la fusion, finiraient un jour par ne plus
coïncider.

### Ce que le barème n'est pas

Un ordre de grandeur, pas une comptabilité carbone certifiée. Il **classe**
correctement les modes entre eux — c'est ce dont le tri par empreinte croissante
a besoin. Un ticket dédié affinera : taux d'occupation réels des lignes TCL, mix
électrique horaire, distinction vélo mécanique / VAE par station. Les valeurs
sont regroupées dans un seul fichier précisément pour que cet affinage n'ait
qu'un endroit à toucher.

## Qui appelle, et quand (UF-502)

`computeFootprint` est appelé **une fois par itinéraire**, dans
`RoutesService.priceItineraries`, juste après la fusion et avant le tri publié.
C'est le seul point d'entrée du barème dans la réponse de `/api/routes/plan`.

| Appelant                    | Ce qu'il en fait                                                 |
| --------------------------- | ---------------------------------------------------------------- |
| `RoutesService`             | **publie** le total, le détail et la référence voiture           |
| `merge/itinerary-merger.ts` | **estime** (via `segmentCarbonGrams`) pour choisir ses candidats |

La distinction est volontaire : la fusion a besoin d'un ordre de grandeur pour
retenir cinq propositions parmi les candidates, mais elle ne publie rien. Ses
`carbonGrams` sont écrasés par les lignes du service, et la liste est
**reclassée** sur les valeurs ainsi publiées — sans quoi un affinage du barème
ici laisserait `/routes/plan` annoncer un tri `carbonAsc` qu'il n'appliquerait
plus. Détail : [`modules/routes/README.md`](../routes/README.md), section
« Intégration dans `/routes/plan` ».

Ce service reste donc libre d'évoluer sans coordination avec la fusion : le seul
contrat entre les deux est le fichier de facteurs.

**Le calcul est purement arithmétique** — aucune I/O, aucun accès base. C'est ce
qui permet de le placer sur le chemin de la réponse sans la rallonger : au plus
cinq itinéraires de quelques segments, contre des centaines de millisecondes de
collecte réseau. La condition à préserver le jour où le barème s'affinera : un
facteur qui devrait être _lu_ quelque part (mix électrique horaire, par exemple)
doit être chargé en amont et mémoïsé, pas récupéré dans `computeFootprint`.

## `getSummary(userId, days)` — le suivi personnel (UF-505)

```
        │◄──── période précédente ────►│◄──── période affichée ────►│
tranche │  0  │  1  │  2  │  3  │      │  4  │  5  │  6  │  7  │   maintenant
        └─────┴─────┴─────┴─────┘      └─────┴─────┴─────┴─────┘
             previous (total)               current + buckets[]
```

Un **unique** `GROUP BY` produit les huit tranches ; le service en tire les deux
totaux, la variation entre eux et la série du graphique. Une requête par tranche
en aurait fait huit pour un seul écran (C5/C10). Les bornes sont calculées en
TypeScript pour que le SQL n'ait aucune arithmétique de calendrier à faire.

**Fenêtre glissante, pas mois calendaire.** « Les 30 derniers jours » et non « ce
mois-ci » : un bilan mensuel est quasiment vide le 1er du mois, et l'évolution
qu'il afficherait le 2 ne voudrait rien dire. Une fenêtre glissante et sa jumelle
immédiatement antérieure comparent toujours deux durées identiques.

**Seuls les trajets retenus comptent.** Une ligne de `search_history` n'entre
dans les totaux qu'une fois son `carbon_grams` posé, c'est-à-dire une fois que
l'usager a **choisi** une option (voir plus bas). Additionner les recherches
abandonnées ferait un bilan de déplacements que personne n'a faits. Ces
recherches sont tout de même dénombrées à part (`unpricedTripsCount`) : sans
cela, un total bas serait incompréhensible pour quelqu'un qui a beaucoup cherché.

**Le module lit `search_history` directement**, sans passer par
`SearchHistoryService`. Ce service existe pour encapsuler les géométries PostGIS
(`ST_MakePoint`, `ST_X`) — or un agrégat de sommes n'en touche aucune et ne
matérialise jamais une entrée d'historique. L'y loger imposerait par ailleurs un
cycle entre les deux modules, `search-history` dépendant déjà de ce service-ci
pour valoriser une sélection.

## Comment l'empreinte arrive en base (UF-505)

La ligne d'historique naît à l'étape 18 du flux, **avant** qu'aucune option
n'existe : `carbon_grams` et `car_equivalent_grams` y sont `NULL`. C'est
`PATCH /api/search-history/:id/selection` (module `search-history`) qui les pose,
quand l'usager retient un itinéraire.

Cet endpoint n'accepte **aucun gramme du client** : il reçoit les couples
(mode, distance) des segments retenus et appelle `computeFootprint`. Le Service
Carbone reste l'autorité unique sur le barème, ici comme à l'étape 6 — un client
qui pourrait poster « 0 g » se fabriquerait un bilan flatteur, et un bilan qu'on
peut se fabriquer ne sert plus à rien.

Les deux valeurs sont **figées** au barème du jour du trajet plutôt que
recalculées à la lecture : le barème est explicitement provisoire, et un bilan
personnel dont les mois passés se réécriraient à chaque affinage ne serait pas un
historique.

## Reste à faire

- **Répartition par mode** (« Bus 44 %, Métro 28 % … » de la maquette) : suppose
  de stocker le détail par segment de chaque trajet retenu, donc une table de
  plus. Hors périmètre du MVP, qui demande explicitement une ou deux
  visualisations sobres.
- **Facteur d'absorption « arbres équivalents »** de la maquette : il ne figure
  pas dans le barème transport de l'ADEME et demanderait sa propre source.

## Dépendances

- `PrismaService` — agrégation de `search_history` pour `getSummary`.
- Consommé par `RoutesModule` (étape 6 du flux), par `SearchHistoryModule`
  (valorisation d'un itinéraire retenu) et par `merge/itinerary-merger.ts` via
  les facteurs d'émission.
- Contrats publiés dans `@urbanflow/shared` (`CarbonFootprint`,
  `CarbonSegmentFootprint`, `CarbonSummary`, `CarbonPeriodTotals`,
  `CAR_REFERENCE_GRAMS_PER_KM`) : le front les consomme sans les redéclarer (C9).

## Tests

```bash
cd apps/api && npx jest src/modules/carbon
```

`emission-factors.spec.ts` fige le **classement** des modes, pas les valeurs : un
affinage du barème est attendu, mais il ne doit jamais retourner l'ordre sans que
le test le signale. Il vérifie aussi que la référence voiture reste au-dessus de
tout mode proposé — sinon « vous avez évité … » deviendrait un reproche.

`carbon.service.spec.ts` fige en plus les trois critères de recette d'UF-505 : un
total pour l'utilisateur connecté, un périmètre de lecture verrouillé sur le JWT
(aucun paramètre ne peut viser un autre compte), et une évolution comparant deux
périodes de **même durée**. Il vérifie également qu'une période vide rend quatre
tranches à zéro plutôt qu'une série absente, et qu'une période précédente vide
rend `null` plutôt qu'une division par zéro.

## Contraintes couvertes

Proposition de valeur écologique (tri CO₂ croissant) ; C8 (l'utilisateur ne voit
que ses données) ; C5 (calcul côté serveur, le client n'en refait aucun) ;
C9 (contrat partagé, unités explicites).
