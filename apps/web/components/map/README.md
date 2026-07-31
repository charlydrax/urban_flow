# Composant `map` — Carte MapLibre GL JS (UF-201)

Brique cartographique de la PWA : elle sert de support au planificateur
d'itinéraires (F2) et, plus tard, à l'écran de navigation temps réel.

Maquettes de référence : Figma « 03 · Maquettes desktop → DESKTOP 2 :
PLANIFICATEUR » (carte en volet droit) et « 02 · Maquettes mobile → 6. NAVIGATION » (carte pleine largeur).

## Fichiers

| Fichier                  | Rôle                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `lazy-map.tsx`           | **Point d'entrée des pages** — chargement différé, `ssr: false`, réserve la hauteur |
| `map-view.tsx`           | Composant carte : instance MapLibre, contrôles, accessibilité, nettoyage            |
| `../../lib/map-style.ts` | Résolution du fond de carte depuis l'environnement (logique pure, testée)           |

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
