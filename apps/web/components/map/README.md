# Composant `map` — Carte MapLibre GL JS (UF-201)

Brique cartographique de la PWA : elle sert de support au planificateur
d'itinéraires (F2) et, plus tard, à l'écran de navigation temps réel.

Maquettes de référence : Figma « 03 · Maquettes desktop → DESKTOP 2 :
PLANIFICATEUR » (carte en volet droit) et « 02 · Maquettes mobile → 6. NAVIGATION » (carte pleine largeur).

## Fichiers

| Fichier                         | Rôle                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `lazy-map.tsx`                  | **Point d'entrée des pages** — chargement différé, `ssr: false`, réserve la hauteur |
| `map-view.tsx`                  | Composant carte : instance MapLibre, contrôles, accessibilité, nettoyage            |
| `use-route-overlay.ts`          | Tracés, repères et cadrage des itinéraires (UF-403) — pendant impératif             |
| `route-legend.tsx`              | Clé de lecture du code couleur, posée sur la carte (UF-403)                         |
| `../../lib/map-style.ts`        | Résolution du fond de carte depuis l'environnement (logique pure, testée)           |
| `../../lib/route-map-layers.ts` | Itinéraires → GeoJSON, emprise, repères, légende (logique pure, testée)             |

Les pages n'importent **jamais** `map-view` directement : MapLibre touche
`window` et WebGL dès l'import, un rendu serveur planterait sur
`window is not defined`.

## Utilisation

```tsx
import { LazyMap } from '../components/map/lazy-map';

// Carte par défaut : Lyon, zoom 13, hauteur de la maquette
<LazyMap />

// Carte pilotée (écran de navigation, F2)
<LazyMap
  className="h-[70vh]"
  center={[4.8467, 45.7602]}
  zoom={15}
  ariaLabel="Itinéraire Part-Dieu → Bellecour"
  textAlternative="Étapes détaillées listées sous la carte."
  onReady={(map) => map.addSource('itineraire', { type: 'geojson', data: geojson })}
/>
```

| Prop                   | Défaut                   | Rôle                                                       |
| ---------------------- | ------------------------ | ---------------------------------------------------------- |
| `center`               | `[4.8357, 45.758]`       | Centre en `[lng, lat]` — convention GeoJSON/MapLibre (C9)  |
| `zoom`                 | `13`                     | Zoom initial                                               |
| `className`            | `h-[420px] md:h-[560px]` | Dimensionnement de l'enveloppe                             |
| `ariaLabel`            | `Carte des itinéraires`  | Étiquette de la région (C7)                                |
| `textAlternative`      | liste textuelle          | Équivalent non visuel lu par les lecteurs d'écran (C7)     |
| `userPosition`         | `null`                   | Marqueur « ma position » (UF-202) — voir plus bas          |
| `itineraries`          | `[]`                     | Itinéraires à tracer (UF-403) — voir plus bas              |
| `selectedItineraryId`  | `null`                   | Itinéraire mis en avant et cadré (UF-403)                  |
| `showGeolocateControl` | `false`                  | Contrôle natif MapLibre — **déconseillé**, voir plus bas   |
| `onReady`              | —                        | Accès à l'instance MapLibre après `load` (sources GeoJSON) |
| `children`             | —                        | Surcouches positionnées au-dessus de la carte (légende…)   |

Changer `center`/`zoom` **déplace la caméra** (`easeTo`) : l'instance n'est
jamais reconstruite, et l'animation est supprimée si l'utilisateur a demandé des
mouvements réduits (C7).

## Choix du fond de carte et coût

Le style est résolu par `buildMapStyle()` dans cet ordre :

| Priorité | Variable                    | Fournisseur                  | Coût                                                                                       |
| -------- | --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| 1        | `NEXT_PUBLIC_MAP_STYLE_URL` | libre (auto-hébergé, autre)  | selon l'hébergement                                                                        |
| 2        | `NEXT_PUBLIC_MAPTILER_KEY`  | MapTiler, style `streets-v2` | **offre gratuite** (~100 000 requêtes de tuiles/mois, sans carte bancaire), payant au-delà |
| 3        | _aucune_                    | OpenStreetMap **raster**     | gratuit, mais soumis à la _Tile Usage Policy_ de l'OSMF                                    |

**Pourquoi MapTiler** : tuiles **vectorielles** — un même jeu de tuiles se
rezoome sans flou et pèse nettement moins qu'un équivalent raster (C5/C10) ;
compatible MapLibre sans surcouche propriétaire ; offre gratuite suffisante pour
un prototype et une soutenance.

**Pourquoi un repli OSM raster** : `npm run dev` doit fonctionner sans compte ni
clé, pour que le projet reste clonable et démontrable tel quel. Ce repli est
**explicitement marqué** (`isFallback: true`) et ne doit pas partir en
production : la politique OSM interdit les usages soutenus.

> Les chiffres de l'offre gratuite sont ceux annoncés à la rédaction du ticket —
> à revérifier avant toute mise en production.

## Sécurité de la clé (C4/C11)

Une clé de tuiles est **nécessairement visible** dans le navigateur : elle part
dans l'URL de chaque requête de tuile. La protéger consiste donc à la
**restreindre par domaine** dans le tableau de bord MapTiler, pas à la cacher.
Ce que le code garantit :

- aucune clé écrite en dur dans le dépôt (vérifié par `lib/map-style.test.ts`) ;
- la valeur est échappée (`encodeURIComponent`) avant d'entrer dans l'URL ;
- `.env` n'est pas commité — seul `.env.example` l'est, avec la variable vide.

## Accessibilité (C7)

- La carte est une **`region` étiquetée**, pas un `role="img"` : ce dernier rend
  les descendants « présentationnels » et masquerait les boutons de zoom aux
  technologies d'assistance. C'est MapLibre qui pose ce rôle sur son canvas ; on
  lui passe notre libellé via `locale['Map.Title']` au lieu d'empiler une
  seconde région sur le conteneur.
- **Libellés des contrôles traduits** (`locale`) : sans ce patch, MapLibre
  annoncerait « Zoom in » au milieu d'une interface française (WCAG 3.1.1).
- Une **alternative textuelle** (`sr-only`) renvoie systématiquement vers
  l'équivalent non visuel — l'information cartographique n'est jamais exclusive.
- Les contrôles MapLibre sont restylés dans `app/globals.css` : focus visible de
  la charte, et cibles tactiles portées à 44 px sur écrans au doigt (WCAG 2.5.5).
- Un échec de chargement du fond affiche un message en `role="status"` plutôt
  qu'un rectangle vide et silencieux (C10 — dégradation gracieuse).

## Géolocalisation et RGPD (C6/C8) — mis à jour par UF-202

**La carte ne géolocalise personne.** Elle affiche la position qu'on lui passe
(`userPosition`) et se recentre si on change `center` : c'est l'écran hôte qui
recueille le consentement, demande la permission et gère les échecs. Le parcours
complet vit dans `features/planner` (voir son README).

```tsx
<LazyMap center={toLngLat(position)} zoom={15} userPosition={position} />
```

Le marqueur est une pastille bleue cerclée de blanc (`.uf-user-marker` dans
`app/globals.css`), avec `role="img"` et une étiquette qui **inclut la
précision** — « Votre position approximative (± 25 m) ». Aucun cercle de
précision n'est tracé : un halo dessiné en pixels laisserait croire à une
exactitude géographique qu'il n'a pas ; la valeur est donnée en toutes lettres à
côté du bouton « Me localiser ».

`showGeolocateControl` (contrôle natif MapLibre) est **désactivé par défaut**
depuis UF-202 : il appelle l'API Geolocation directement, sans passer par le
consentement horodaté côté serveur. Ne l'activer que sur un écran qui n'offre
aucun parcours consenti.

## Cycle de vie et fuites mémoire (C5)

`map.remove()` est appelé au démontage : canvas WebGL, workers et écouteurs sont
détruits. C'est indispensable ici — `reactStrictMode` monte chaque effet deux
fois en développement, ce qui révèle immédiatement une instance orpheline.

## Interaction avec le service worker

Le service worker (`sw.ts`) n'intercepte que les navigations, `POST /routes/plan`
et les assets `/_next/static/` de **même origine**. Les tuiles, servies par un
domaine tiers, passent donc directement au réseau — pas de cache silencieux ni
de quota gonflé.

## Étapes suivantes (F2)

- Tracer les itinéraires renvoyés par `POST /api/routes/plan` en sources/couches
  GeoJSON via `onReady` (couleurs par mode : `lib/design-tokens.ts`).
- Placer la légende « Segment vélo / Segment bus » de la maquette dans la
  surcouche `children` (carte blanche, rayon 14, ombre, en bas à droite).

## Tracé des itinéraires (UF-403) — C7 / C9 / C5

La carte reçoit une liste d'itinéraires et l'identifiant de celui à mettre en
avant. Elle ne calcule rien et ne choisit rien : c'est `PlannerScreen` qui
détient les deux (voir `features/planner/README.md`).

### Deux modules, une frontière nette

```
lib/route-map-layers.ts          components/map/use-route-overlay.ts
  (pur, testé en node)                (impératif, exige WebGL)
        │                                        │
  itinéraires ──► FeatureCollection ──► source `uf-routes` + 5 couches
             ──► emprise            ──► fitBounds
             ──► repères            ──► Marker MapLibre
             ──► légende            ──► RouteLegend
```

La logique décidable vit hors du DOM, donc testable sans navigateur
(`lib/route-map-layers.test.ts`, 14 cas). Le pendant impératif ne contient plus
que des appels MapLibre.

### Cinq couches, et pourquoi pas une

`line-dasharray` **n'est pas une propriété pilotable par la donnée** dans
MapLibre : on ne peut pas écrire `["get", "pattern"]` dans un `dasharray`. Un
motif par mode impose donc une couche par motif. La couleur, elle, est bien
data-driven — une seule expression `["get", "color"]` couvre les sept modes.

| Couche                   | Filtre                 | Rôle                                               |
| ------------------------ | ---------------------- | -------------------------------------------------- |
| `uf-routes-alternatives` | non sélectionné        | Les autres options, à 30 % d'opacité               |
| `uf-routes-casing`       | sélectionné            | Liseré blanc — garantit le contraste (WCAG 1.4.11) |
| `uf-routes-solid`        | sélectionné + `solid`  | Vélo, trottinette                                  |
| `uf-routes-dashed`       | sélectionné + `dashed` | Bus, tram, métro, covoiturage                      |
| `uf-routes-dotted`       | sélectionné + `dotted` | Marche                                             |

Une **seule** source (`uf-routes`) porte tous les itinéraires : changer de
sélection repousse la même donnée avec un booléen différent, là où des sources
par itinéraire imposeraient d'en créer et d'en détruire à chaque clic (C5).

### Code couleur des modes

Repris des tokens `--color-mode-*` de la charte (UF-007, maquette Figma
« DESKTOP 2 : PLANIFICATEUR ») — jamais redéfini ici, pour que la pastille d'une
carte de résultat et le tracé correspondant restent la même couleur.

| Mode        | Couleur   | Motif     |
| ----------- | --------- | --------- |
| Marche      | `#5a6478` | pointillé |
| Vélo        | `#1fa85c` | plein     |
| Trottinette | `#b85000` | plein     |
| Bus         | `#1e66e0` | tirets    |
| Tram        | `#00746a` | tirets    |
| Métro       | `#7a2ebf` | tirets    |
| Covoiturage | `#8a5300` | tirets    |

**Écarts assumés à la maquette**, tous deux faute de tracé maquetté :

- la **marche** n'y figure pas ; elle prend l'encre neutre Ink 500 plutôt qu'une
  sixième couleur vive, qui concurrencerait le mode caractérisant l'option. Le
  pointillé demandé par le ticket la rend malgré tout identifiable ;
- le **covoiturage** n'est encore produit par aucune source (F3 = GTFS + GBFS).
  Il est mappé sur l'ocre « warning » pour que le tableau des modes reste
  exhaustif — ajouter un mode doit casser la compilation, pas passer inaperçu.

### Repères

| Repère         | Apparence (maquette)               | Position                         |
| -------------- | ---------------------------------- | -------------------------------- |
| Départ         | pastille bleue pleine, « A » blanc | premier point du premier segment |
| Arrivée        | pastille verte pleine, « B » blanc | dernier point du dernier segment |
| Correspondance | pastille creuse cerclée de couleur | changement de **mode**           |

Une correspondance est un **changement de mode**, pas une jonction de segments :
marcher puis marcher encore ne mérite pas de repère, descendre du vélo pour
prendre le bus, si. Elle est colorée par le mode qui **commence** — le repère
annonce ce qu'on prend, il ne commémore pas ce qu'on quitte.

### Accessibilité (C7)

- **Le motif double la couleur** (WCAG 1.4.1) : un daltonisme deutan rapproche
  fortement le vert vélo et le brun trottinette, le trait plein contre le tireté
  reste lisible. Un test vérifie qu'aucun couple (couleur, motif) n'est partagé.
- **Le liseré blanc** garantit ≥ 3:1 sous chaque trait, quel que soit ce qu'il
  recouvre — bâti gris, parc vert, fleuve bleu (WCAG 1.4.11). Un test le vérifie
  couleur par couleur.
- **L'alternative textuelle décrit le tracé** dès qu'il y en a un, en `aria-live`
  poli : « Itinéraire tracé sur la carte : Marche de … à … (5 min), puis Métro B
  … ». Annoncer « les itinéraires y seront tracés » alors qu'ils le sont déjà
  n'apprendrait plus rien (WCAG 1.1.1).
- **Les repères portent une étiquette** (`role="img"` + `aria-label`) : sans
  elle, ils ne seraient que des `div` vides au milieu du canvas.
- **Le cadrage respecte `prefers-reduced-motion`** : `fitBounds` sans animation
  (WCAG 2.3.3), comme le recentrage de la caméra.

## Tracé réel, et tracé approché (UF-702)

Le serveur publie désormais, pour chaque segment, **d'où vient sa polyligne** :
`geometrySource: 'routed'` quand elle suit le réseau réel (voirie OSM pour la
marche et le vélo, `shapes.txt` du GTFS pour les transports en commun),
`'straight'` quand il a fallu se replier sur la droite à vol d'oiseau.

Rien ne change au dessin : mêmes couleurs, mêmes motifs, mêmes couches — le
ticket demande explicitement de réutiliser le code couleur en place. Ce qui
change, c'est la **géométrie** dessinée dessous, et elle arrive telle quelle
dans `toRouteFeatureCollection`.

Ce qui s'ajoute, en revanche, c'est de **le dire**. Un cheminement le long d'une
rue rectiligne et un repli produisent le même objet GeoJSON : rien, dans la
géométrie, ne distingue les deux. Laisser une droite qui traverse un pâté de
maisons passer pour un cheminement calculé enverrait l'usager contre un mur
(C6). D'où, quand `hasApproximateTrack(itinerary)` est vrai :

- une **note sous la légende** : « Certains segments sont tracés en ligne
  droite, faute d'itinéraire détaillé disponible. » ;
- la **même phrase dans l'alternative textuelle** (`describeRoute`), pour qui
  n'a pas accès à la carte — une information portée par le seul visuel n'en est
  pas une (C7 — WCAG 1.1.1). La note visuelle est donc `aria-hidden`, comme le
  reste de la légende, pour ne pas être lue deux fois.

`geometrySource` **absent** ne déclenche rien : les réponses antérieures au
ticket, qu'un Service Worker peut encore servir (C10), n'en portent pas.
L'absence se lit « on ne sait pas », et avertir au hasard rendrait
l'avertissement insignifiant là où il compte.

Une conséquence gratuite, et voulue : le mode simulation (UF-701) interpole le
long de `segment.geometry`. Il suit donc le nouveau tracé sans qu'une ligne ait
eu à changer — le point de démonstration parcourt les rues, pas la diagonale.

### Tests

```bash
cd apps/web && npm run test    # dont lib/route-map-layers.test.ts
```

Couvre la construction du GeoJSON (un tronçon par segment, couleur par mode,
drapeau de sélection), le fait qu'un segment sans tracé soit ignoré sans faire
tomber le reste (C10), l'emprise, la pose des repères et le non-doublonnage des
correspondances, la légende dynamique, la description textuelle, les deux
garanties d'accessibilité du code couleur, et le signalement des tracés
approchés (UF-702) — y compris le silence attendu quand le marquage manque.
