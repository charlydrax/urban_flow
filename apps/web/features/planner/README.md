# Module `planner` — Planificateur d'itinéraires (F2)

Écran d'accueil de la PWA : saisie du trajet, géolocalisation consentie, calcul
des itinéraires, tracé sur la carte et panneau de résultats. Depuis UF-403 le
module couvre le flux de référence de bout en bout — de la saisie (étape 1) à
l'affichage carte (étape 9) ; UF-404 y ajoute la liste qui permet de **comparer**
les options avant d'en choisir une.

Maquettes : Figma « 02 · Maquettes mobile → 1. ACCUEIL » et « 4. PLANIFICATEUR
F2 », « 03 · Maquettes desktop → DESKTOP 2 : PLANIFICATEUR ».

## Fichiers

| Fichier                           | Rôle                                                                     |
| --------------------------------- | ------------------------------------------------------------------------ |
| `planner-screen.tsx`              | Frontière client : partage position, itinéraires et historique           |
| `planner-form.tsx`                | État du trajet, géolocalisation → départ, inversion, soumission          |
| `use-route-plan.ts`               | Appel `POST /routes/plan`, état de la recherche, sélection (UF-403)      |
| `itinerary-list.tsx`              | Panneau de résultats — groupe radio de cartes comparables (UF-404)       |
| `itinerary-card.tsx`              | Carte d'un itinéraire : durée, séquence de modes, CO₂, horaires (UF-404) |
| `trip-fields.tsx`                 | Carte départ/arrivée de la maquette + bouton d'inversion                 |
| `address-autocomplete.tsx`        | Champ d'adresse au motif ARIA « combobox » + liste de suggestions        |
| `use-address-search.ts`           | Débounce 300 ms, annulation de la requête précédente, états de recherche |
| `locate-me.tsx`                   | Bouton « Me localiser », panneau de consentement, comptes rendus         |
| `use-user-location.ts`            | Machine à états du parcours (consentement → permission → position)       |
| `recent-searches.tsx`             | Trajets récents recliquables affichés sous les champs (UF-204)           |
| `use-search-history.ts`           | Lecture unique de l'historique, entretenue localement ensuite (UF-204)   |
| `../../lib/itinerary-cards.ts`    | Itinéraire → séquence de modes, horaires, phrase lue (pur, testé)        |
| `../../lib/route-map-layers.ts`   | Itinéraires → GeoJSON, emprise, repères, légende (pur, testé)            |
| `../../lib/geocoding.ts`          | Appels BAN normalisés : recherche, géocodage inverse (pur, testé)        |
| `../../lib/geolocation.ts`        | Appel `navigator.geolocation` normalisé + formats (pur, testé)           |
| `../../lib/format-search-date.ts` | Libellés « aujourd'hui, 09:12 » / « hier » / date courte (pur, testé)    |

## Recherche d'adresses (UF-203) — C5 / C9 / C7

### Le géocodeur retenu : la BAN

La **Base Adresse Nationale** (`api-adresse.data.gouv.fr`) plutôt que Nominatim :

|                     | BAN                                      | Nominatim (OSM)                        |
| ------------------- | ---------------------------------------- | -------------------------------------- |
| Clé d'API           | aucune                                   | aucune                                 |
| Autocomplétion      | prévue (`autocomplete=1`)                | **interdite** par la politique d'usage |
| Couverture          | France uniquement                        | mondiale                               |
| Précision en France | numéro de voie, arrondissements lyonnais | variable selon la contribution         |

Pour une métropole française, la limite de couverture est sans conséquence et
l'autorisation explicite d'autocompléter est décisive. Un besoin transfrontalier
futur demanderait un second géocodeur.

**Limite connue** : la BAN est une base d'**adresses**, pas de points d'intérêt.
« gare » ou « hôtel de ville » n'y remontent rien, là où « place Bellecour » et
« 14 rue de la République » sont trouvés immédiatement. C'est assumé à ce stade :
les arrêts et pôles d'échange viendront des données **GTFS** (F3), qui en sont la
source légitime. Le message d'état vide oriente vers la formulation qui marche.

### Le parcours

```
frappe dans « Départ » ou « Arrivée »
      │
      ├─ moins de 3 caractères ? ──oui──► aucun appel réseau
      │
      └─non→ pause de 300 ms sans nouvelle frappe (débounce)
                 │
                 ├─ une requête était en vol ? ──► AbortController.abort()
                 │
                 └─ GET /search/?q=…&autocomplete=1&lat=45.758&lon=4.8357&limit=5
                          │
              ┌───────────┼───────────────────────┐
          suggestions   liste vide            réseau / service KO
              │            │                       │
      filtrage bbox    « aucune adresse       message + saisie
      métropole de      dans la métropole »    libre toujours
      Lyon                                      possible
              │
        sélection (clic, ou ↓/↑ + Entrée)
              │
      { label, lat, lng } mémorisé — coordonnées affichées sous le champ
```

### Ce qui limite les appels (C5/C10) — recette 4

Trois verrous cumulés, tous observables dans l'onglet Réseau :

1. **Longueur minimale** : sous 3 caractères, `searchAddresses` rend la main sans
   toucher au réseau (la BAN répondrait `400` de toute façon).
2. **Débounce 300 ms** : c'est la pause entre deux mots d'une frappe courante.
   Taper « bellecour » coûte **1 requête** au lieu de 9.
3. **Annulation** : chaque frappe avorte la requête précédente. Au-delà de
   l'économie, cela supprime le bug classique de l'autocomplétion — une réponse
   ancienne qui arrive après une plus récente et réaffiche des suggestions
   périmées. Une réponse annulée ne peut plus toucher l'état.

S'y ajoute un quatrième effet : une fois une suggestion choisie, la recherche est
**désactivée** (`value.place !== null`). Réécrire le libellé dans le champ ne
relance donc rien, et refermer puis rouvrir la liste réutilise les suggestions
déjà en mémoire.

### Restreindre à Lyon : trois mécanismes, pas un

- **Biais** — `lat`/`lon` transmis à la BAN (centre de Lyon) : classe les
  homonymes par proximité. Mesuré sur des saisies réelles, « jean jaurès » passe
  de 0 à 3 adresses lyonnaises et « garibaldi » de 1 à 6.
- **Sur-récupération** — on demande `SEARCH_FETCH_LIMIT` (10) candidats pour n'en
  afficher que `SUGGESTION_LIMIT` (5). Le biais _classe_ mais ne _restreint_
  pas : sur « bellecour », la BAN place trois lieux-dits de l'Ain et du Loiret
  avant la place de Lyon. Demander cinq résultats n'en laisserait qu'un après
  filtrage. Cela reste **une seule requête** — c'est sa taille qui change, pas
  leur nombre (C5).
- **Filtre** — `isWithinLyonArea` écarte ce qui tombe hors de l'emprise de la
  métropole, puis on tronque à cinq.

L'emprise est volontairement large (les 59 communes du Grand Lyon et quelques
limitrophes) : refuser Villeurbanne, Bron ou Vénissieux rendrait l'outil inutile.

Pourquoi pas le filtre `citycode` de la BAN, qui serait plus net ? Parce qu'il
porte sur **une seule commune** : il exclurait Villeurbanne et toute la
périphérie, c'est-à-dire l'essentiel des trajets réels.

### Ce qui est envoyé au géocodeur (C8/C11)

Le **texte tapé**, et rien d'autre : pas d'identifiant de compte, pas de cookie
(`credentials: 'omit'`), pas d'en-tête d'authentification. Le biais transmis est
le centre de Lyon — une constante publique — et **jamais la position réelle** de
l'utilisateur : chercher « république » ne doit pas révéler à un tiers où se
trouve la personne.

### Géolocalisation → adresse

« Me localiser » (UF-202) remplit le départ **immédiatement** avec ses
coordonnées, puis ce libellé est remplacé par l'adresse réelle dès que le
géocodage inverse répond — comme sur la maquette (« Départ · position actuelle →
14 rue de la République, Lyon 2e »). L'utilisateur n'attend jamais le réseau
(C10) ; une panne du géocodeur laisse simplement les coordonnées, qui restent une
valeur parfaitement valide.

Le remplacement ne touche **que notre propre libellé** : si l'utilisateur a repris
la main entre-temps, l'adresse trouvée est abandonnée (drapeau `autofilled`).

### Texte libre ou adresse résolue

Le champ reste un champ de texte ordinaire — on peut y taper n'importe quoi. Mais
seule la **sélection d'une suggestion** produit un `lat/lng`, et c'est cela que la
soumission exige. Ce compromis évite deux écueils opposés : un champ verrouillé
qui refuserait la frappe libre, et un formulaire qui accepterait « chez moi » puis
échouerait côté serveur.

## Géolocalisation (UF-202) — C6 / C8

### Le parcours

```
clic « Me localiser »
      │
      ├─ consentement déjà enregistré ? ──oui──┐
      │            (GET /users/me)             │
      │                                        │
      └─non→ panneau de consentement           │
                 │            │                │
            « Non merci »  « Autoriser »       │
                 │            │                │
                 │      PATCH /users/me        │
                 │   {geolocationConsent:true} │
                 │            │                │
                 ▼            ▼                ▼
          saisie manuelle    navigator.geolocation.getCurrentPosition()
                                  │
             ┌────────────────────┼────────────────────┐
          autorisé              refusé            timeout / GPS muet
             │                    │                    │
     marqueur + recentrage   message + saisie   message + saisie
     + départ pré-rempli        manuelle           manuelle
```

### Deux consentements, à ne pas confondre

|                           | Qui le détient                          | Ce qu'il prouve                                           | Où le retirer          |
| ------------------------- | --------------------------------------- | --------------------------------------------------------- | ---------------------- |
| **Consentement RGPD**     | notre base (`User.consentAt`, horodaté) | l'utilisateur a accepté que l'app **utilise** sa position | écran Profil (UF-107)  |
| **Permission navigateur** | le navigateur                           | l'utilisateur laisse le site **lire** le capteur          | réglages du navigateur |

Le premier est **traçable et opposable** (recette 4 du ticket) : c'est le serveur
qui horodate, pas l'horloge du poste client. Le second est un verrou technique
qu'on ne contrôle pas. Les deux sont exigés avant toute lecture de position.

Conséquence assumée : **si l'API est injoignable, on ne géolocalise pas** — sans
trace de consentement, pas de collecte. L'écran le dit et renvoie vers la saisie
manuelle.

### Ce que le code ne fait pas, volontairement

- **Pas de géolocalisation au chargement** : la permission n'est demandée qu'au
  clic (le ticket l'exige, et un `getCurrentPosition` au montage se solde de
  toute façon par un refus permanent dans la plupart des navigateurs).
- **Pas de `watchPosition`** : une position ponctuelle suffit à pré-remplir un
  départ. Un suivi continu serait une collecte disproportionnée (C8) et une
  ponction de batterie (C5).
- **Pas d'`enableHighAccuracy`** : la précision réseau situe un quartier, ce qui
  est le besoin réel ; le GPS fin coûte du temps et de la batterie.
- **Pas de position envoyée au serveur** à ce stade : elle ne quitte le
  navigateur qu'avec la future requête d'itinéraire.
- **Pas de contrôle `GeolocateControl` sur la carte** : le bouton natif de
  MapLibre court-circuiterait le consentement tracé. Il est désactivé par défaut
  depuis ce ticket (`showGeolocateControl`).

### Les trois issues (C6)

`lib/geolocation.ts` réduit l'API du navigateur à quatre causes d'échec —
`denied`, `timeout`, `unavailable`, `unsupported` — chacune avec son message et
sa conduite à tenir dans `GEOLOCATION_ERROR_MESSAGES`. Aucune ne lève
d'exception, aucune ne bloque l'écran : le repli est toujours le même — Lyon sur
la carte, saisie manuelle dans le formulaire.

La **précision** est affichée en toutes lettres (`± 25 m`) : une position à
± 2 km ne se lit pas comme une position à ± 20 m, et l'utilisateur doit pouvoir
juger si le départ pré-rempli est crédible.

## Trajets récents (UF-204) — C5 / C8 / C10

Chaque soumission valide est enregistrée (étape 18 du flux) et les derniers
trajets reviennent sous les champs, recliquables.

> ⚠️ **Le producteur a changé avec UF-403.** L'écriture était faite ici par un
> `POST /search-history` ; c'est désormais `POST /routes/plan` qui l'effectue et
> qui rend la ligne créée. Voir la section UF-403 plus bas.

```
soumission valide
      │
      └─► POST /routes/plan  ──► { …, searchHistoryId }
                │
                ├─ id non nul ─► noteRecorded() : l'entrée passe en tête de liste
                │                (insertion LOCALE, aucun appel réseau), son
                │                doublon disparaît
                └─ id nul     ─► silence : ne pas mémoriser un trajet ne doit pas
                                 se lire comme une panne de la recherche (C10)
```

**Une seule lecture, puis plus rien** : la liste est chargée à l'ouverture de
l'écran, puis entretenue localement. Aucune relecture après écriture, aucune
requête périodique (C5).

**Rejouer coûte zéro appel** : une entrée d'historique porte déjà ses
coordonnées, donc un clic remplit les deux champs **déjà résolus** — le géocodeur
n'est pas resollicité et l'utilisateur n'a pas à re-sélectionner une suggestion.
Le formulaire n'est pas soumis pour autant : on ajuste souvent une extrémité
avant de relancer.

**Pas d'historique sans session** : le middleware (UF-106) protège déjà l'écran,
mais il n'agit qu'à la navigation. Le hook suit donc l'état réel de
`SessionProvider` : dès qu'il retombe, la liste est vidée de la mémoire du
navigateur et plus aucun appel n'est émis (C8).

Le dédoublonnage est appliqué **des deux côtés** : par l'API à la lecture
(`DISTINCT ON`), et localement après un enregistrement. Sans quoi relancer un
trajet fréquent le ferait apparaître deux fois jusqu'au prochain chargement.

## Accessibilité (C7)

### Autocomplétion — motif ARIA « combobox »

Le champ est un `combobox` relié à une `listbox` : l'état ouvert/fermé
(`aria-expanded`), la liste (`aria-controls`) et l'option courante
(`aria-activedescendant`) sont annoncés. Le **focus ne quitte jamais le champ** —
c'est ce qui permet de continuer à taper pendant que la liste défile, et ce qui
évite de piéger un utilisateur au clavier.

| Touche    | Effet                                        |
| --------- | -------------------------------------------- |
| `↓` / `↑` | Parcourt les suggestions, avec bouclage      |
| `Entrée`  | Valide la suggestion active (sans soumettre) |
| `Échap`   | Ferme la liste sans rien changer             |
| `Tab`     | Quitte le champ, la liste se referme         |

Un `role="status"` visuellement masqué annonce le nombre de suggestions : une
liste qui apparaît en silence est invisible pour un lecteur d'écran. L'inversion
départ/arrivée est annoncée de la même façon — les libellés des champs ne
changent pas, seul leur contenu permute.

Les options réagissent au `mousedown` et non au `click` : le clic déclencherait
d'abord le `blur` du champ, qui fermerait la liste avant que la sélection
n'arrive.

**Écart assumé à la maquette** : la double-flèche d'inversion y est en Ink 300,
un gris trop clair pour un élément interactif (WCAG 1.4.11 exige 3:1). Elle est
remontée en Ink 500. Sa zone cliquable fait 44 × 44 px (WCAG 2.5.5) alors que le
glyphe n'en fait que 15.

Les pastilles départ/arrivée se distinguent par la **forme** (creux / plein)
autant que par la couleur, pour rester lisibles en cas de daltonisme (WCAG 1.4.1).

### Trajets récents

Chaque rappel est un **bouton** (`type="button"` — sans quoi il soumettrait le
formulaire qui l'entoure), atteignable au `Tab` et déclenché par `Entrée`. La
flèche « → » étant décorative (`aria-hidden`), le `aria-label` reformule
l'action : « Reprendre le trajet X vers Y, aujourd'hui 09:12 ». Sans lui, un
lecteur d'écran énoncerait deux adresses collées sans dire ce qui se passe au
clic (WCAG 2.4.4). La zone cliquable fait 44 px de haut (WCAG 2.5.5).

### Géolocalisation

- Le résultat est **écrit sous le bouton**, pas seulement posé sur la carte :
  coordonnées, précision, et messages d'erreur.
- Attente et succès en `role="status"`, échecs en `role="alert"`.
- Le panneau de consentement reçoit le focus à son apparition (WCAG 4.1.3) sans
  piéger la navigation clavier : ce n'est pas une modale.
- Le marqueur de position porte un `role="img"` et une étiquette incluant la
  précision ; le halo pulsé s'arrête sous `prefers-reduced-motion` (WCAG 2.3.3).

## Tests

```bash
cd apps/web && npm run test    # lib/geolocation.test.ts + lib/geocoding.test.ts
```

`geolocation.test.ts` couvre la normalisation des trois cas d'échec GPS,
l'inversion `lat/lng → [lng, lat]` (C9) et les formats affichés.

`geocoding.test.ts` couvre la requête envoyée à la BAN (autocomplétion, biais
Lyon, plafond de résultats), l'absence d'appel réseau sous 3 caractères, le
filtrage hors métropole, l'ordre GeoJSON, et le fait qu'aucune panne du service
ne lève d'exception. `fetch` y est simulé : **la CI ne dépend pas de la
disponibilité de la BAN**.

`format-search-date.test.ts` fige les libellés des trajets récents et vérifie
qu'on compte des **journées de calendrier** et non des heures écoulées (23h05 la
veille vu à 00h30, c'est « hier »), ainsi que le repli d'un horodatage futur.

`route-map-layers.test.ts` (UF-403) couvre la traduction des itinéraires en
données de carte : voir `components/map/README.md`.

`itinerary-cards.test.ts` (UF-404) fige la séquence de modes (fusion des segments
consécutifs de même ligne, deux lignes distinctes qui restent distinctes), les
horaires (heure de quai quel que soit le fuseau du poste, `null` plutôt qu'«
Invalid Date ») et la phrase lue aux technologies d'assistance. Il vérifie aussi
que les sept modes de l'énumération partagée ont un pictogramme : en ajouter un
sans icône afficherait `undefined` dans la séquence.

Les tests de composants (jsdom + Testing Library) restent à ajouter. La logique
d'UF-403 a été poussée dans un module **pur** (`lib/route-map-layers.ts`)
précisément pour être couverte sans eux ; ce qui reste dans les composants et les
hooks est de l'orchestration React et des appels MapLibre.

## Calcul et affichage des itinéraires (UF-403) — C7 / C9 / C10

C'est le ticket qui **branche enfin le front sur l'API** : jusqu'ici le
formulaire s'arrêtait à la constitution du `{from, to}`.

### Le parcours

```
soumission valide (deux adresses géocodées)
      │
      ▼
PlannerScreen → useRoutePlan.plan(from, to)
      │
      ▼
POST /api/routes/plan  { from, to }        (aucun userId — C4, cf. UF-402)
      │
      │  l'API lit le profil, interroge les 3 sources en parallèle,
      │  fusionne, calcule le CO₂ et enregistre la recherche
      ▼
{ itineraries[], sortedBy, sources[], searchHistoryId }
      │
      ├─► carte      : tracés par mode, repères A/B + correspondances, fitBounds
      ├─► sélecteur  : le premier est retenu d'office (le serveur l'a classé premier)
      └─► historique : la ligne créée remonte en tête, sans requête supplémentaire
```

### Qui possède quoi

`PlannerScreen` est le plus petit ancêtre commun des trois enfants qui partagent
des données, et rien de plus :

| Donnée          | Producteur         | Consommateurs                                  |
| --------------- | ------------------ | ---------------------------------------------- |
| Position        | `useUserLocation`  | formulaire (départ), carte (marqueur, centre)  |
| Itinéraires     | `useRoutePlan`     | carte (tracés), sélecteur (choix)              |
| Trajets récents | `useSearchHistory` | formulaire (rappels), résultat de la recherche |

`useSearchHistory` a été **remonté du formulaire vers l'écran** par ce ticket :
il y vivait tant que c'était le formulaire qui écrivait l'historique. Ce n'est
plus le cas.

### L'historique n'est plus écrit par le front

Depuis UF-402, `POST /routes/plan` enregistre lui-même la recherche (étape 18 du
flux) et renvoie la ligne créée dans `searchHistoryId`. Le `POST /search-history`
que le formulaire émettait ferait désormais **deux lignes pour un seul trajet**.

Il est donc remplacé par `noteRecorded(id, from, to)` : une insertion **locale**,
sans appel réseau — l'API vient d'écrire, nous avons l'identifiant et les deux
extrémités, relire la collection pour retrouver ce qu'on sait déjà coûterait un
aller-retour par recherche (C5).

`apiClient.createSearchHistory` reste en place : l'endpoint existe toujours au
contrat, il n'a simplement plus d'appelant dans ce parcours.

Un `searchHistoryId` à `null` (écriture échouée côté serveur) n'est pas signalé :
la liste n'est pas mise à jour, et c'est tout. Ne pas mémoriser un trajet est un
désagrément, pas une panne de la recherche (C10).

### Concurrence des recherches

Une recherche relancée avant la fin de la précédente **écarte** la réponse
périmée (compteur de requête dans `useRoutePlan`). Sans ce garde-fou, une
première réponse lente écraserait une seconde plus rapide, et l'écran afficherait
le trajet précédent — le bug classique de toute liste asynchrone.

### Ce que le client ne recalcule pas

Le tri, l'empreinte et l'écriture de l'historique sont faits par le serveur, qui
**publie** ce qu'il a fait (`sortedBy`, `carbonGrams`, `searchHistoryId`).
Rejouer ces décisions côté client garantirait qu'un jour les deux divergent. Le
sélecteur se contente donc d'**annoncer** le classement appliqué (« classés par
empreinte carbone croissante »), sans le déduire en comparant les valeurs.

### Périmètre : ce qui restait à UF-404 et UF-405

`itinerary-switcher.tsx` n'était **pas** le panneau de résultats de la maquette :
UF-403 n'en livrait que le strict nécessaire pour rendre le tracé _pilotable_.
Il a été **remplacé** par `itinerary-list.tsx` + `itinerary-card.tsx` (UF-404,
section suivante).

Le bandeau « mode dégradé » alimenté par `sources[]` relève toujours d'UF-405 :
`useRoutePlan` expose déjà la donnée, personne ne l'affiche encore.

### Accessibilité (C7)

- **Le choix d'itinéraire est un groupe de boutons radio**, pas une série de
  boutons : c'est ce qui dit aux technologies d'assistance qu'on désigne **un**
  élément parmi plusieurs, et cela apporte la navigation aux flèches — au `Tab`
  on entre dans le groupe et on en sort, sans le traverser option par option
  (WCAG 4.1.2). L'état retenu se voit à la bordure et au texte autant qu'au fond
  (WCAG 1.4.1). Chaque ligne fait au moins 44 px de haut (WCAG 2.5.5).
- **L'attente est annoncée** : le bouton devient « Calcul en cours… » et est
  désactivé, doublé d'un `role="status"` masqué (WCAG 4.1.3).
- **Une liste vide est un résultat, pas une erreur** : elle est rendue en
  `role="status"` et non en `role="alert"`. L'inverse enverrait l'usager vérifier
  sa connexion pour rien.
- **L'échec réseau est en `role="alert"`**, avec un message générique : le statut
  HTTP et le détail renvoyé par l'API restent côté serveur (C11).
- Le tracé lui-même : voir `components/map/README.md`.

## Panneau de résultats (UF-404) — C2 / C7 / C9

Une carte par itinéraire, pour **comparer** avant de choisir. C'est la maquette
« 5. RÉSULTATS F2+F3 ».

```
┌──────────────────────────────────────────────┐
│ ● [Meilleur choix · le plus rapide]   22 min │  ← la durée d'abord : c'est
│                                              │    ce qu'on compare
│ 🚶 3 › 🚲 11 › 🚌 C3 6 › 🚶 2                │  ← la séquence de modes
│                                              │
│ 🌱 240 g CO₂   ♿ Accessible   09:41 → 10:03 │  ← les infos secondaires
└──────────────────────────────────────────────┘
```

### Le lien avec la carte (recette 2)

Sélectionner une carte remonte l'identifiant à `PlannerScreen`, qui le passe à
`LazyMap` : `use-route-overlay` repousse alors **la même** source GeoJSON avec un
`selected` différent, met le tracé retenu en avant, estompe les autres et recadre
dessus. La liste ne touche jamais MapLibre — le lien passe par l'état partagé, pas
par un couplage au moteur de rendu.

Le lien est aussi **visuel** : chaque pastille de mode porte la couleur de son
tracé (`MODE_TRACK_STYLES`, UF-403). C'est ce qui fait reconnaître, dans le trait
bleu tireté dessiné à droite, le « 🚌 » lu à gauche. Deux nuances différentes pour
un même bus rompraient le lien que la recette demande d'établir.

### Ce que la carte affiche, et pourquoi dans cet ordre

| Élément                  | Pourquoi il est là                                                             |
| ------------------------ | ------------------------------------------------------------------------------ |
| Durée, en gras à droite  | c'est le critère que l'œil balaye verticalement d'une carte à l'autre          |
| Séquence de modes        | « Marche + Bus » de 22 min peut cacher 18 min de marche : les durées le disent |
| Badge « Meilleur choix » | dit **pourquoi** le premier est premier, d'après `sortedBy` du serveur         |
| Badge CO₂                | l'emplacement de la maquette, rempli (cf. plus bas)                            |
| Mention PMR              | `Itinerary.accessible` — une contrainte, pas un agrément (C12)                 |
| Créneau horaire          | deux options de même durée ne partent pas à la même heure                      |

Les segments **consécutifs de même mode et même ligne** sont fusionnés : un métro
B repris après un changement de quai afficherait sinon deux pastilles identiques
côte à côte, et le lecteur y verrait deux trajets là où il n'y en a qu'un. Deux
lignes de bus différentes restent, elles, deux pastilles — c'est bien un
changement de véhicule.

### Le badge CO₂ est rempli, pas réservé

Le ticket demandait de « réserver visuellement l'emplacement du badge CO₂ (rempli
au Sprint 5) ». La donnée existe **depuis UF-401** : `carbonGrams` est calculé par
le Service Carbone et publié dans la réponse. Une pastille vide n'aurait rien
appris à personne, et sa place dans la mise en page étant celle de la maquette,
la remplir plus tard n'aurait rien déplacé. L'emplacement est donc là **et** il
porte sa valeur.

### Écarts assumés à la maquette

Trois éléments de la maquette sont **absents** plutôt qu'inventés :

| Élément maquette    | Pourquoi il n'est pas là                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| « ★ Recommandé IA » | aucun modèle ne classe les options : c'est le tri du profil (F1). Le badge dit donc la vraie raison, tirée de `sortedBy` |
| « · 1,90 € »        | aucune source ne publie de tarif à ce stade (F3)                                                                         |
| « ⭐ +45 pts »      | la gamification est hors périmètre du prototype (CLAUDE.md §3)                                                           |

Le tri, lui, suit `sortedBy` **publié par le serveur** et non « par durée par
défaut » comme l'énonçait le ticket : depuis UF-401 c'est la priorité du profil
qui décide, et le client se contente d'annoncer laquelle a été appliquée. Rejouer
la décision côté client garantirait qu'un jour les deux divergent.

### Les horaires viennent de la source, jamais d'un calcul (C9)

`Itinerary.departureAt` / `arrivalAt` ont été **ajoutés au contrat** par ce ticket
(voir `apps/api/src/modules/routes/README.md`, « Horaires publiés »). Trois cas :

- **trajet TC** — les horaires du moteur GTFS, republiés tels quels ;
- **rabattement à vélo + TC** — la fenêtre est ancrée sur les segments datés, les
  voisins étant décalés de leur propre durée ;
- **tout-vélo** — aucun horaire : cet itinéraire part quand l'usager décide. La
  carte n'affiche alors que sa durée.

L'heure est rendue dans le fuseau du **réseau** (Europe/Paris), pas dans celui du
navigateur : un horaire GTFS est une heure de quai, et un poste resté à l'heure
de Londres afficherait sinon 08:41 pour un bus qui passe à 09:41.

### Accessibilité du panneau (C7)

- **Le groupe radio est conservé** depuis UF-403, et il compte davantage
  maintenant : avec quatre cartes de six lignes chacune, entrer et sortir du
  groupe au `Tab` plutôt que de le traverser option par option n'est plus une
  subtilité (WCAG 4.1.2).
- **Toute la carte est cliquable** — c'est un `<label>`, donc la cible fait la
  taille du bloc et non celle d'un disque de 16 px (WCAG 2.5.5).
- **Une phrase, pas des fragments** : `describeItinerary` pose sur le radio un
  `aria-label` complet (« Option 1 sur 3. 22 minutes. Marche 3 min, puis Bus C3
  6 min… »). Sans lui, un lecteur d'écran énoncerait « 22 min, 3, 11, 6 » — les
  pictogrammes et les couleurs ne portent aucune information pour lui (WCAG
  1.1.1). Le reste de la carte est donc en `aria-hidden` : le redire pastille par
  pastille rallongerait l'écoute sans rien apprendre.
- **L'état retenu se voit à la bordure épaissie et au fond teinté**, pas
  seulement à la couleur (WCAG 1.4.1).
- **Mobile-first (C2)** : les cartes s'empilent sur toute la largeur, sans
  dépendre d'un point de rupture ; la séquence de modes passe à la ligne au lieu
  de déborder. À partir de `md`, seule la largeur du conteneur change.
