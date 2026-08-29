# Interopérabilité — formats et contrats (UF-606 · C9)

> Ce document répond à la contrainte **C9** : « formats standards (GTFS, GBFS,
> GeoJSON), API REST documentée (Swagger) ». Il rassemble en un endroit ce que
> les documents de connecteur (`otp-gtfs.md`, `gbfs-velov.md`) décrivent chacun
> de leur côté, et surtout : il dit **où chaque affirmation est vérifiée**.

---

## 1. Pourquoi ce document existe

« Nous utilisons des formats standards » est une phrase qu'on peut écrire sans
la respecter. GTFS, GBFS et GeoJSON sont des noms ; ce sont les spécifications
derrière ces noms qui font l'interopérabilité, et rien dans un dossier ne prouve
qu'elles sont suivies.

UrbanFlow ne consomme donc pas seulement des formats normalisés : il **republie**
des données dans des formats normalisés, et cette conformité est tenue par des
tests qui tournent à chaque `npm test`. Le tableau de la section 6 fait le lien
ligne à ligne entre une norme, l'endroit du code qui l'implémente et le test qui
la vérifie.

L'argument d'interopérabilité du projet tient en une phrase : **un tiers qui n'a
jamais vu ce code peut consommer l'API avec des outils standard** — un client
OpenAPI généré, une bibliothèque GeoJSON quelconque, un parseur ISO 8601 — sans
lire une ligne de notre documentation métier.

---

## 2. Ce qui entre : les sources

| Source                 | Norme                              | Rôle                             | Connecteur                                    |
| ---------------------- | ---------------------------------- | -------------------------------- | --------------------------------------------- |
| Transports en commun   | **GTFS** (via OpenTripPlanner)     | horaires et réseau TCL           | `apps/api/src/modules/transport/otp/`         |
| Vélos en libre-service | **GBFS v2**                        | stations et disponibilité Vélo'v | `apps/api/src/modules/transport/gbfs/`        |
| Pistes cyclables       | **GeoJSON** (open data Grand Lyon) | aménagements cyclables           | `apps/api/src/modules/transport/cycle-paths/` |

Les trois sont des formats **publics et documentés hors de ce projet**. C'est
l'essentiel de l'argument : UrbanFlow n'a négocié aucun format propriétaire avec
aucun opérateur. Remplacer Lyon par une autre métropole revient à changer trois
URL, pas à réécrire trois connecteurs.

Le détail de chaque source — d'où elle vient, pourquoi ce miroir plutôt que
l'API officielle, comment la vérifier à la main — est dans
[`otp-gtfs.md`](./otp-gtfs.md) et [`gbfs-velov.md`](./gbfs-velov.md).

### La traduction, et pourquoi elle a lieu

Aucun de ces vocabulaires ne traverse la frontière du connecteur. GBFS parle de
`form_factor: "bicycle"` et de `propulsion_type: "electric_assist"` ; le produit
parle de `mode: "BIKE"` et de `electric: true`. GTFS parle de `route_type` ;
le produit parle de `METRO`, `TRAM`, `BUS`.

Ce n'est pas une couche de plus pour le plaisir. C'est ce qui fait que :

- **le Service Carbone** peut distinguer un vélo musculaire d'un vélo à
  assistance — ils n'ont pas le même facteur d'émission — sans connaître GBFS ;
- **le client** type ses affichages sur une énumération unique
  (`@urbanflow/shared`) plutôt que sur le vocabulaire d'un opérateur ;
- **ajouter une seconde flotte** (trottinettes, un autre opérateur) se limite à
  écrire un mapper, sans toucher ni à la fusion ni à l'interface.

---

## 3. Ce qui sort : les formats republiés

### GeoJSON — RFC 7946

Tout tracé publié par l'API est une `LineString` GeoJSON, en `[longitude,
latitude]`, l'ordre normatif de la RFC (§3.1.1) :

```json
{
  "type": "LineString",
  "coordinates": [
    [4.859057, 45.760515],
    [4.848, 45.7565]
  ]
}
```

Deux tracés sont publiés par itinéraire, et c'est délibéré : `Itinerary.geometry`
pour le trait d'ensemble, `RouteSegment.geometry` pour chaque tronçon. Une
`LineString` unique ne dirait plus où la marche s'arrête et où le métro commence,
donc ne permettrait pas de colorer la carte par mode.

**Absence plutôt qu'invalidité.** Quand une source n'a pas produit deux points
distincts, le champ est **omis** — jamais rempli d'une « ligne » d'un seul point,
qui serait invalide au sens de la RFC. Un consommateur tiers sait ignorer un
champ absent ; il ne sait pas rattraper une géométrie dégénérée.

### ISO 8601 — horodatages

Tout instant publié est une chaîne ISO 8601 **avec fuseau** :
`2026-08-26T08:15:00+02:00`.

Le fuseau n'est pas décoratif. `2026-08-26T08:15:00` est une chaîne ISO valide
dont l'instant dépend du fuseau du lecteur : un horaire de bus lu à Londres se
décalerait d'une heure. GBFS publie des secondes epoch, OTP des millisecondes ;
les deux sont converties à la frontière du connecteur.

Même règle d'absence que pour les géométries : un tronçon vélo ou une marche
n'ont pas d'horaire _de source_, seulement une durée. Leur en inventer un ferait
passer une estimation pour une donnée de réseau.

### Unités

| Grandeur  | Unité publiée | Champ             |
| --------- | ------------- | ----------------- |
| Durée     | minutes       | `durationMinutes` |
| Distance  | mètres        | `distanceMeters`  |
| Empreinte | grammes CO₂e  | `carbonGrams`     |

Une seule unité par grandeur dans tout le contrat, suffixée dans le nom du
champ. `distance: 1200` laisserait le lecteur choisir entre mètres et kilomètres ;
`distanceMeters: 1200` ne le laisse pas.

### OpenAPI / Swagger

Le contrat REST est publié et explorable sur **`/api/docs`**
(`apps/api/src/main.ts`). Il est **généré** depuis les classes DTO NestJS, pas
rédigé à côté du code : un endpoint qui change sans que sa documentation suive
est impossible par construction.

C'est la pièce qui rend l'argument opérationnel : un tiers génère son client
depuis ce document, sans nous parler.

### Source de vérité unique du contrat

Les types du contrat vivent dans **`packages/shared`**, consommé par les deux
applications :

```
packages/shared/src/route.ts     ──┬──►  apps/api  (classes DTO Swagger)
                                   └──►  apps/web  (client API typé)
```

Une divergence front/back sur la forme d'un itinéraire n'est donc pas un bogue
qu'on découvre à l'exécution : c'est une erreur de compilation.

---

## 4. Ce que l'accessibilité doit à l'interopérabilité (C12)

Le champ `Itinerary.accessible` ne sort pas d'une estimation maison : il vient
des attributs d'accessibilité que **GTFS** publie sur les arrêts et les
véhicules, remontés par OpenTripPlanner. Le filtre « itinéraires accessibles
PMR » du profil (UF-602) s'appuie donc sur une donnée normalisée de l'exploitant,
pas sur une supposition.

C'est un point où C9 et C12 se rejoignent : la norme de transport est
respectable parce que le format de transport la transporte.

---

## 5. Vérifier à la main

```bash
# Le contrat REST, explorable
open http://localhost:3001/api/docs

# Un itinéraire complet, avec géométries et horodatages
curl -s -X POST http://localhost:3001/api/routes/plan \
  -H 'Content-Type: application/json' \
  -b "access_token=$TOKEN" \
  -d '{"from":{"label":"Part-Dieu","lat":45.760515,"lng":4.859057},
       "to":{"label":"Bellecour","lat":45.757813,"lng":4.832011}}' \
  | jq '.itineraries[0] | {id, departureAt, arrivalAt, geometry: .geometry.type,
                           segments: [.segments[] | {mode, departureAt, geometry: .geometry.type}]}'

# Le document d'auto-découverte GBFS de l'opérateur : quels flux publie-t-il ?
curl -s "$GBFS_DISCOVERY_URL" | jq '.data.fr.feeds[].name'
```

Le tracé renvoyé se colle tel quel dans [geojson.io](https://geojson.io) : s'il
s'y affiche sur Lyon, l'ordre des axes est bon. Intervertis, les mêmes points
tomberaient au large du golfe de Guinée — c'est exactement ce que vérifie
l'enveloppe géographique du test de conformité.

---

## 6. Où chaque affirmation est vérifiée

| Affirmation                                                | Vérifiée par                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| Les tracés publiés sont des `LineString` RFC 7946 valides  | `apps/api/src/modules/routes/interoperability.spec.ts`      |
| Aucune géométrie dégénérée n'est publiée (absence assumée) | idem                                                        |
| Les axes ne sont pas intervertis (`[lng, lat]`)            | idem — enveloppe géographique lyonnaise                     |
| Les horodatages portent un fuseau et se relisent           | idem                                                        |
| Départ ≤ arrivée sur chaque fenêtre horodatée              | idem                                                        |
| Les modes publiés appartiennent au vocabulaire partagé     | idem                                                        |
| `lon` (GBFS) → `lng` (contrat) sans inversion              | idem                                                        |
| `last_reported` (epoch GBFS) → ISO 8601 sans décalage      | idem                                                        |
| `form_factor`/`propulsion_type` → modes + motorisation     | idem, et `transport/gbfs/gbfs.mapper.spec.ts`               |
| La lecture des flux GBFS distants est tolérante aux pannes | `transport/gbfs/gbfs.client.spec.ts`                        |
| La lecture d'OTP l'est aussi                               | `transport/otp/otp.client.spec.ts`                          |
| Le décodage des polylignes GTFS/OTP est exact              | `transport/otp/otp.mapper.spec.ts`                          |
| Le contrat REST est publié et à jour                       | généré depuis les DTO — `apps/api/src/main.ts`, `/api/docs` |
| Front et back partagent une seule définition du contrat    | compilation TypeScript (`packages/shared`)                  |

```bash
npm test --workspace apps/api    # dont la recette d'interopérabilité
```

---

## 7. Limites assumées

- **Ce qui est vérifié, c'est ce que le serveur publie**, pas ce que l'opérateur
  envoie. La conformité des flux distants ne dépend pas de nous ; leur lecture
  tolérante, si, et c'est ce que couvrent les tests de client.
- **GTFS-RT (temps réel) n'est pas consommé.** Le prototype travaille sur les
  horaires théoriques du jeu GTFS. Les maquettes affichent « données temps réel
  TCL · GTFS-RT » ; c'est une intention de produit, pas un état du code.
- **Le flux GTFS utilisé est un miroir daté** (voir `otp-gtfs.md`) : le flux
  officiel Grand Lyon exige un compte. Cela n'affecte pas la conformité au
  format, seulement la fraîcheur des horaires.
- **Nous ne publions pas de flux GTFS/GBFS sortant.** UrbanFlow consomme ces
  normes et republie du GeoJSON et de l'OpenAPI ; devenir producteur GTFS n'a
  pas de sens pour un agrégateur d'itinéraires.
