# Module `planner` — Planificateur d'itinéraires (F2)

Écran d'accueil de la PWA : saisie du trajet, géolocalisation consentie, calcul
des itinéraires, tracé sur la carte et panneau de résultats. Depuis UF-403 le
module couvre le flux de référence de bout en bout — de la saisie (étape 1) à
l'affichage carte (étape 9) ; UF-404 y ajoute la liste qui permet de **comparer**
les options avant d'en choisir une.

Maquettes : Figma « 02 · Maquettes mobile → 1. ACCUEIL » et « 4. PLANIFICATEUR
F2 », « 03 · Maquettes desktop → DESKTOP 2 : PLANIFICATEUR ».

## Fichiers

| Fichier                            | Rôle                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `planner-screen.tsx`               | Frontière client : partage position, itinéraires et historique           |
| `planner-form.tsx`                 | État du trajet, géolocalisation → départ, inversion, soumission          |
| `use-route-plan.ts`                | Appel `POST /routes/plan`, état de la recherche, sélection (UF-403)      |
| `itinerary-list.tsx`               | Panneau de résultats — groupe radio de cartes comparables (UF-404)       |
| `itinerary-card.tsx`               | Carte d'un itinéraire : durée, séquence de modes, CO₂, horaires (UF-404) |
| `itinerary-filters.tsx`            | Bandeau « Tous / Rapide / Écolo / Économe » du panneau (UF-503, UF-804)  |
| `trip-options-chips.tsx`           | Chips « heure de départ » et « voyageurs » (UF-804)                      |
| `mode-selector.tsx`                | Grille des six modes de transport retenus pour la recherche (UF-804)     |
| `eco-mode-banner.tsx`              | Bandeau « mode éco » — annonce le tri que le serveur applique (UF-804)   |
| `realtime-cards.tsx`               | Les deux encarts « données F3 » du bas de la planche (UF-804)            |
| `use-realtime-context.ts`          | Bornes proches + état des sources, une fois par recherche (UF-804)       |
| `carbon-breakdown.tsx`             | Détail CO₂ de l'option retenue : segment, facteur, comparaison (UF-501)  |
| `itinerary-skeleton.tsx`           | Esquisse du panneau pendant le calcul — réserve la place (UF-405)        |
| `plan-notice.tsx`                  | Message d'état : vide, panne, session expirée, mode dégradé (UF-405)     |
| `planner-screen.tsx` (note)        | Bandeau « sans compte » du visiteur + lien de connexion (UF-801)         |
| `trip-fields.tsx`                  | Carte départ/arrivée de la maquette + bouton d'inversion                 |
| `address-autocomplete.tsx`         | Champ d'adresse au motif ARIA « combobox » + liste de suggestions        |
| `use-address-search.ts`            | Débounce 300 ms, annulation de la requête précédente, états de recherche |
| `locate-me.tsx`                    | Bouton « Me localiser », panneau de consentement, comptes rendus         |
| `use-user-location.ts`             | Machine à états du parcours (consentement → permission → position)       |
| `../../lib/geolocation-consent.ts` | Accord d'un invité mémorisé sur l'appareil (UF-802, pur, testé)          |
| `recent-searches.tsx`              | Trajets récents recliquables affichés sous les champs (UF-204)           |
| `use-search-history.ts`            | Lecture unique de l'historique, entretenue localement ensuite (UF-204)   |
| `../../lib/itinerary-cards.ts`     | Itinéraire → séquence de modes, horaires, phrase lue (pur, testé)        |
| `../../lib/carbon-breakdown.ts`    | Détail carbone publié → lignes, barres, phrase lue (pur, testé)          |
| `../../lib/carbon-badge.ts`        | Empreinte publiée → pastille, niveau, comparaison voiture (pur, testé)   |
| `../../lib/plan-feedback.ts`       | Erreur ou état des sources → message et rôle ARIA (pur, testé)           |
| `../../lib/route-map-layers.ts`    | Itinéraires → GeoJSON, emprise, repères, légende (pur, testé)            |
| `../../lib/geocoding.ts`           | Appels BAN normalisés : recherche, géocodage inverse (pur, testé)        |
| `../../lib/geolocation.ts`         | Appel `navigator.geolocation` normalisé + formats (pur, testé)           |
| `../../lib/format-search-date.ts`  | Libellés « aujourd'hui, 09:12 » / « hier » / date courte (pur, testé)    |
| `../../lib/trip-options.ts`        | Options d'écran → corps de requête, catalogue des modes (pur, testé)     |
| `../../lib/realtime-cards.ts`      | Bornes + état des sources → les deux encarts F3 (pur, testé)             |

## Options de recherche et cartes temps réel (UF-804)

Mise en conformité des deux écrans centraux avec la planche Figma. Quatre
ajouts, et une règle qui les gouverne tous : **un contrôle affiché doit changer
quelque chose de vérifiable**.

### Ce que chaque contrôle fait réellement

| Contrôle                 | Envoyé au serveur | Effet mesurable                                                          |
| ------------------------ | ----------------- | ------------------------------------------------------------------------ |
| Chip « heure de départ » | `departAt`        | l'heure interrogée dans le moteur GTFS                                   |
| Chip « voyageurs »       | `travellers`      | une borne doit avoir assez de vélos **et** de places pour tout le groupe |
| Sélecteur de modes       | `modes`           | filtre dur : un mode décoché ne revient dans aucun itinéraire            |
| Bandeau « mode éco »     | _rien_            | il **annonce** ; c'est la priorité du profil (F1) qui décide             |
| Bandeau de filtres (×4)  | _rien_            | retri en mémoire des itinéraires déjà reçus — zéro requête (C5)          |

La frontière est nette et se lit à l'écran : **au-dessus de la liste on demande,
en dessous on relit**. C'est ce qui permet aux quatre pastilles de ne coûter
aucun appel réseau tout en portant le mot « filtre » de la planche.

### Absent ≠ valeur par défaut

`toPlanOptions` n'ajoute au corps que les champs qui **contraignent**. Un écran
qu'on n'a pas touché envoie `{ from, to }` — exactement la requête d'avant le
ticket. Sans cette règle, ouvrir la page ferait publier au serveur un
`excludedModes` complet, et l'écran annoncerait un filtre que personne n'a posé.

### Les deux cartes temps réel, et ce qu'elles n'affirment pas

| Carte           | Source                           | Fraîcheur      | Ce qui est affiché          |
| --------------- | -------------------------------- | -------------- | --------------------------- |
| Station         | `GET /transport/stations/nearby` | **temps réel** | « 7 véhicules disponibles » |
| Prochain départ | horaire GTFS de l'option retenue | **théorique**  | « départ à 09:47 »          |

La planche écrit « passe dans 4 min » sous une étiquette « GTFS-RT ». Nous
n'avons pas de GTFS temps réel — le flux officiel TCL est fermé (401) et la
source branchée est un miroir statique daté (`docs/otp-gtfs.md`). Un décompte
affirmerait qu'on suit le véhicule, ce que nous ne faisons pas : la carte affiche
donc une **heure**, et dit d'où elle vient. Le suivi réellement continu est le
sujet d'UF-806.

`GET /transport/status` alimente la ligne de provenance des deux cartes : un flux
GBFS figé nuance la disponibilité affichée sans la cacher (C10).

### Écarts assumés par rapport à la planche

| Planche                                      | Ici                                         | Pourquoi                                                                                                                  |
| -------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Chips en badges statiques                    | `datetime-local` et `<select>` natifs       | clavier, lecteur d'écran et sélecteur système gratuits ; un menu maison coûtait un piège à focus et du bundle (C5)        |
| Filtre « Économe » adossé à un prix          | adossé au **nombre de titres de transport** | aucune de nos sources ne publie de tarif ; inventer une grille afficherait un chiffre faux à côté de mesures (C9)         |
| Prix par itinéraire (« 1,90 € »)             | absent                                      | même raison — le périmètre du projet ne comporte pas d'intégration billettique                                            |
| Tuile de mode en couleur vive, texte compris | bordure et fond teintés, texte Ink 900      | vert 500 sur vert 50 donne 3.1:1 à 12 px, sous le seuil AA de 4.5:1 (C7 — WCAG 1.4.3)                                     |
| « Recommandé IA » sur la première carte      | badges « Choix vert » / « Le plus rapide »  | aucune IA ne classe ces options : c'est un tri sur des valeurs publiées, et le dire autrement serait un argument de vente |
| Points de gamification (« +45 pts »)         | absent                                      | la fonctionnalité au choix retenue est l'empreinte carbone (CLAUDE.md §3) — pas de compteur sans jeu derrière             |
| Vue par défaut « Écologique » (UF-503)       | vue par défaut « Tous »                     | l'ancien défaut dupliquait le tri serveur : juste pour un profil « écolo », mensonger pour un profil « rapide »           |

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
      │   connecté → GET /users/me             │
      │   invité   → localStorage (UF-802)     │
      │                                        │
      └─non→ panneau de consentement           │
                 │            │                │
            « Non merci »  « Autoriser »       │
                 │            │                │
                 │   connecté → PATCH /users/me│
                 │            {geolocationConsent:true}
                 │   invité   → localStorage   │
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

### Invité et connecté : deux façons de consigner l'accord (UF-802)

`getProfile()` ouvrait le parcours **quelle que soit** la personne. Sur un
visiteur sans compte, cet appel répond `401` : « Me localiser » échouait donc
systématiquement, et précisément sur l'écran qu'UF-801 venait d'ouvrir à tous.
La géolocalisation est une capacité du navigateur — elle n'a jamais eu besoin
d'un profil pour fonctionner, seulement d'un accord.

|                                 | Connecté                               | Invité                             |
| ------------------------------- | -------------------------------------- | ---------------------------------- |
| Lecture de l'accord             | `GET /users/me`                        | `localStorage` de l'appareil       |
| Écriture de l'accord            | `PATCH /users/me` (horodatage serveur) | `localStorage`                     |
| Appels réseau pour se localiser | 1 à 2                                  | **aucun** (C5)                     |
| Révocation                      | écran Profil (UF-107)                  | « Effacer ma position », sur place |

Pourquoi l'appareil et pas la base : un invité n'a ni identifiant ni ligne où
poser une date. Lui en créer un reviendrait à **collecter plus de données pour
tracer un accord de ne rien collecter** — l'inverse de la minimisation (C8). Et
il n'y a rien à opposer côté serveur, puisque la position d'un invité sert au
calcul en cours et n'est écrite nulle part (`searchHistoryId: null`).

Le panneau de consentement dit donc les choses différemment selon le cas
(`CONSENT_RECORD_NOTICE` dans `locate-me.tsx`) : promettre à un visiteur une
révocation « depuis votre profil » serait faux sur les deux points.

Pour un invité, « Effacer ma position » **retire aussi l'accord** de l'appareil :
c'est son seul chemin de retrait, et le retrait doit être aussi simple que
l'accord (RGPD art. 7-3). Pour un compte, le même bouton n'efface que l'écran —
révoquer en douce derrière un libellé qui n'annonce que la position serait une
surprise, pas une garantie.

### Deux consentements, à ne pas confondre

|                           | Qui le détient                                               | Ce qu'il prouve                                           | Où le retirer                            |
| ------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------- |
| **Consentement RGPD**     | notre base (`User.consentAt`) — ou l'appareil pour un invité | l'utilisateur a accepté que l'app **utilise** sa position | écran Profil, ou « Effacer ma position » |
| **Permission navigateur** | le navigateur                                                | l'utilisateur laisse le site **lire** le capteur          | réglages du navigateur                   |

Le premier est **traçable et opposable** (recette 4 du ticket) : c'est le serveur
qui horodate, pas l'horloge du poste client. Le second est un verrou technique
qu'on ne contrôle pas. Les deux sont exigés avant toute lecture de position.

Conséquence assumée : **si l'API est injoignable, on ne géolocalise pas un
utilisateur connecté** — sans trace de consentement, pas de collecte. L'écran le
dit et renvoie vers la saisie manuelle. Un invité, lui, n'a rien à demander à
l'API : son parcours reste entier hors ligne.

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
cd apps/web && npm run test    # lib/geolocation*.test.ts + lib/geocoding.test.ts
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

`carbon-breakdown.test.ts` (UF-501) vérifie surtout ce que le module **ne fait
pas** : aucun gramme n'y est recalculé. Un barème modifié côté serveur s'affiche
tel quel, sans redéploiement du front. Il couvre aussi l'appariement positionnel
avec les segments (c'est de là que viennent « Part-Dieu → Saxe » et « Bus C3 »),
la division par un total nul d'un itinéraire tout-marche, et le silence complet
quand l'itinéraire ne porte pas de détail.

`geolocation-consent.test.ts` (UF-802) couvre l'accord d'un invité : mémorisé
sur l'appareil, relu sans réseau, retirable, et **jamais supposé** quand le
stockage est indisponible (rendu serveur, navigation privée, politique
d'entreprise) — dans ce cas on redemande, on n'ouvre pas la géolocalisation. Le
stockage y est injecté : le module reste pur, donc testé en environnement `node`.

`use-user-location.test.tsx` (UF-802) est le premier test de **hook** du module,
et il est en `.tsx` pour tomber dans la suite jsdom (`vitest.config.ts`).
Il démontre les recettes 1 et 2 du ticket : en invité, `getProfile` n'est
**jamais** appelé — le défaut corrigé était un défaut de parcours, pas
d'affichage — et l'accord ne quitte pas l'appareil ; en connecté, le parcours
passe toujours par l'API et l'horodatage serveur, et « Effacer ma position » ne
révoque rien.

Les autres tests de composants (jsdom + Testing Library) restent à ajouter. La
logique d'UF-403 a été poussée dans un module **pur** (`lib/route-map-layers.ts`)
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

Depuis UF-402, `POST /routes/plan` enregistre lui-même la recherche (étape 7 du
flux) et renvoie la ligne créée dans `searchHistoryId`. Le `POST /search-history`
que le formulaire émettait aurait fait **deux lignes pour un seul trajet** ;
UF-807 a retiré l'endpoint, resté sans appelant depuis.

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

> UF-503 ajoute un retri d'affichage, et n'entame pas cette règle : il réordonne
> des valeurs publiées, il n'en produit aucune. Voir « Tri par empreinte
> croissante » plus bas.

### Périmètre : ce qui restait à UF-404 et UF-405

`itinerary-switcher.tsx` n'était **pas** le panneau de résultats de la maquette :
UF-403 n'en livrait que le strict nécessaire pour rendre le tracé _pilotable_.
Il a été **remplacé** par `itinerary-list.tsx` + `itinerary-card.tsx` (UF-404,
section suivante).

Le bandeau « mode dégradé » alimenté par `sources[]` a été livré par **UF-405**
(dernière section de ce README), avec le squelette de chargement et le tri des
cas d'erreur.

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
  sa connexion pour rien. Depuis UF-405, avec une exception : quand les **trois**
  sources se sont tues, la liste vide est une panne et repasse en `role="alert"`.
- **L'échec réseau est en `role="alert"`**, avec un message générique : le statut
  HTTP et le détail renvoyé par l'API restent côté serveur (C11).
- Le tracé lui-même : voir `components/map/README.md`.

## Panneau de résultats (UF-404) — C2 / C7 / C9

Une carte par itinéraire, pour **comparer** avant de choisir. C'est la maquette
« 5. RÉSULTATS F2+F3 ».

```
┌──────────────────────────────────────────────┐
│ ● [🌱 Choix vert] [⚡ Le plus rapide]  22 min │  ← la durée d'abord : c'est
│                                              │    ce qu'on compare
│ 🚶 3 › 🚲 11 › 🚌 C3 6 › 🚶 2                │  ← la séquence de modes
│                                              │
│ (🌱 240 g CO₂) −89 % vs voiture   ♿   09:41 │  ← les infos secondaires
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

### Le choix alimente le bilan carbone (UF-505)

Depuis UF-505, sélectionner une carte fait aussi un second travail :
`useRoutePlan.select` appelle `PATCH /api/search-history/:id/selection` pour
inscrire l'option retenue sur la ligne d'historique de la recherche. C'est ce qui
remplit la page « Mon impact ».

**Seul un clic compte.** La première option est présélectionnée à l'arrivée des
résultats, mais c'est un classement du serveur, pas une décision — elle n'est
donc pas enregistrée. Un bilan carbone doit compter des déplacements, pas des
suggestions.

**L'enregistrement ne gêne jamais la sélection.** La mise en avant est appliquée
avant l'appel réseau et ne l'attend pas ; un échec d'écriture est silencieux. Ne
pas comptabiliser un trajet est un désagrément, l'annoncer comme une panne en
serait une vraie (dégradation gracieuse — C10). Même règle que pour l'écriture de
l'historique elle-même.

**Le corps ne porte aucun gramme** : seulement le résumé de l'option et les
couples (mode, distance) de ses segments. Le Service Carbone valorise côté
serveur — sinon n'importe qui s'inscrirait un bilan à zéro (C4).

### Ce que la carte affiche, et pourquoi dans cet ordre

| Élément                 | Pourquoi il est là                                                             |
| ----------------------- | ------------------------------------------------------------------------------ |
| Durée, en gras à droite | c'est le critère que l'œil balaye verticalement d'une carte à l'autre          |
| Séquence de modes       | « Marche + Bus » de 22 min peut cacher 18 min de marche : les durées le disent |
| Badges de mise en avant | désignent l'option la moins émettrice et la plus rapide (UF-503)               |
| Badge CO₂               | l'empreinte **et son niveau**, teinté selon le rapport à la voiture (UF-504)   |
| Mention PMR             | `Itinerary.accessible` — une contrainte, pas un agrément (C12)                 |
| Créneau horaire         | deux options de même durée ne partent pas à la même heure                      |

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

## Tri par empreinte croissante (UF-503) — C2 / C5 / C7

La liste s'ouvre **du moins au plus émetteur**. C'est le parti pris du produit :
l'ordre de lecture est ce qui oriente vraiment un choix, bien plus qu'un chiffre
affiché à côté d'une option déjà mise en tête.

### Le partage avec le serveur

| Décision                       | Qui la prend | Ce qui la porte                            |
| ------------------------------ | ------------ | ------------------------------------------ |
| Ordre **publié** (le défaut)   | serveur      | `sortedBy` dans la réponse                 |
| Ordre **affiché** (le retri)   | client       | état local d'`ItineraryList`, non persisté |
| Valeurs comparées              | serveur      | `carbonGrams`, `durationMinutes`           |
| Qui est « le plus écologique » | client       | minimum sur les valeurs publiées           |

Le dernier point est le seul qui puisse surprendre, et il ne contredit pas la
règle « le client ne rejoue pas les décisions du serveur » : chercher le minimum
d'une liste de nombres n'est pas un second barème carbone. Il n'y a rien à garder
en phase — l'alternative aurait été un champ `greenestId` dans la réponse, à
tenir cohérent avec `carbonGrams` pour dire exactement la même chose.

La justification côté API est dans
[`apps/api/src/modules/routes/README.md`](../../../api/src/modules/routes/README.md),
section « Tri par empreinte croissante ».

### Pourquoi le retri ne repasse pas par l'API (C5)

Rappeler `POST /routes/plan` pour relire cinq itinéraires dans l'autre sens
relancerait la collecte des trois sources — plusieurs secondes — et pourrait
rendre des itinéraires **différents** (horaires GTFS avancés, borne Vélo'v vidée
entre-temps). Un retri doit réordonner ce qu'on a sous les yeux, jamais en
changer le contenu. Zéro requête pour un changement de vue.

`sortItineraries` (dans `lib/itinerary-cards.ts`) applique les **mêmes règles de
départage** que le serveur : à empreinte égale on classe sur la durée, et
réciproquement. Sans ce second critère, l'ordre d'un ex æquo dépendrait de la
stabilité du `sort` du moteur JavaScript.

### Ce qui garantit que la durée ne devient jamais le défaut

Trois choses, et aucune n'est une convention à respecter de bonne foi :

1. le choix vit dans l'état local du panneau — ni `localStorage`, ni profil, ni
   paramètre d'URL ;
2. il est **repris au tri du serveur dès que `sortedBy` change**, c'est-à-dire à
   chaque nouvelle recherche. La remise à zéro est faite pendant le rendu (motif
   React d'ajustement d'état sur changement de prop) et non dans un `useEffect`,
   qui provoquerait un premier rendu avec l'ancien tri — donc un
   réordonnancement visible des cartes juste après l'arrivée des résultats ;
3. « Écologique » est le premier bouton du groupe, donc le premier atteint au
   clavier.

Le point 2 ne repose volontairement pas sur le démontage du composant. Il a lieu
aujourd'hui — l'écran affiche un squelette pendant le calcul, donc la liste
disparaît — mais c'est un détail de mise en page d'UF-405, pas une garantie :
une liste qui resterait montée pendant la recherche garderait sinon le tri
précédent sans que rien ne le signale.

### Les badges ne dépendent plus de la position

UF-404 badgeait la première carte et traduisait `sortedBy` pour dire pourquoi
elle était première. Cela ne tient plus dès qu'on peut retrier : le badge
désignerait l'option la plus rapide comme la plus écologique sitôt le tri par
durée choisi.

La mise en avant est donc devenue une **propriété de l'itinéraire**
(`itineraryHighlights`), et elle suit sa carte :

| Badge                                    | Qui le porte                   |
| ---------------------------------------- | ------------------------------ |
| 🌱 Choix vert · empreinte la plus faible | l'itinéraire le moins émetteur |
| ⚡ Le plus rapide                        | l'itinéraire le plus court     |

Un même itinéraire peut porter les deux — c'est le cas heureux, et le cacher
priverait l'usager de l'argument le plus fort qu'on ait à lui donner. En cas
d'ex æquo, un seul est badgé : deux « choix vert » côte à côte ne mettent plus
rien en avant, et c'est le départage du serveur qui tranche.

**L'option la plus écologique reste mise en avant même quand la liste est
classée par durée** — c'est précisément là qu'elle en a le plus besoin.

### Accessibilité (C7)

- **Un groupe radio, pas deux boutons** : choisir un tri, c'est retenir une
  option parmi deux qui s'excluent. Le motif radio le dit aux technologies
  d'assistance et donne la navigation aux flèches (WCAG 4.1.2).
- **Le radio natif est masqué mais pas retiré du flux** (`peer` + `sr-only`) : il
  garde le focus clavier, et l'anneau de focus est repeint sur l'étiquette qui le
  suit (WCAG 2.4.7).
- **L'état retenu se lit au fond plein et au texte en gras**, jamais à la seule
  couleur (WCAG 1.4.1). Le tri du serveur est en plus signalé « (tri par défaut) »
  en `sr-only` : sans cette mention, un usager qui a basculé sur « Rapide »
  n'aurait plus aucun moyen de savoir lequel des deux est le classement d'origine.
- **Les badges sont repris dans l'`aria-label` du radio** de la carte
  (`describeItinerary`), et posés en `aria-hidden` dans le visuel : ils y sont
  peints en couleur et en gras, ce qui ne dit rien à un lecteur d'écran.
- **`aria-live` sur le décompte, pas sur la liste** : un retri ne change aucune
  carte, seulement leur ordre. Réannoncer les quatre à chaque bascule noierait
  l'information utile — « c'est maintenant classé par durée » — sous la relecture
  de tout le panneau.
- **Mobile-first (C2)** : le décompte et le sélecteur tiennent sur une ligne et
  passent l'un sous l'autre quand la colonne est trop étroite.

### Ce que le retri ne touche pas

Ni les tracés de la carte, ni l'itinéraire retenu. Réordonner des cartes ne
change pas ce qui est dessiné, et déplacer la sélection ferait bouger la caméra
pour une raison purement cosmétique.

## Cas non nominaux (UF-405) — C7 / C10 / C11

Les branches d'erreur du diagramme de séquence, traitées une par une. Le principe
tient en une phrase : **quatre situations très différentes se ressemblent toutes à
l'écran quand on ne fait rien** — une liste vide.

### Les quatre cas, et ce qui les distingue

| Situation                   | Ce qui l'identifie                          | Ce que l'écran fait                                        |
| --------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Aucun trajet trouvé         | `200`, liste vide, sources disponibles      | message neutre en `role="status"`                          |
| Aucune source n'a répondu   | `200`, liste vide, `sources` tous à `false` | message d'échec en `role="alert"` + invitation à réessayer |
| Une source manque sur trois | `200`, liste pleine, un `available: false`  | note discrète « certaines options peuvent manquer »        |
| Session expirée             | `401` sur `POST /routes/plan`               | message expliquant la redirection, déjà lancée             |

`sources[]` est la **seule** chose qui sépare les deux premières lignes, et c'est
exactement pourquoi l'API le publie depuis UF-305. Sans lui, « votre trajet n'a
pas de solution » et « nos fournisseurs sont en panne » seraient le même écran.

### Où vit la décision

```
apiClient.planRoutes ──rejette──> classifyPlanFailure(error)   ← lib/plan-feedback.ts (pur, testé)
                                        │
                     ┌──────────────────┼───────────────────┐
                     ▼                  ▼                   ▼
              session-expired     invalid-request      unavailable
                     │                  │                   │
                     └──────> PLAN_FAILURE_NOTICES { role, message }
                                        │
   200 + liste vide ──> describeEmptyResult(sources) ──────┤
   200 + liste pleine ─> describeDegradedSources(sources) ─┤
                                                           ▼
                                                    <PlanNotice> (peint)
```

Le hook publie la **nature** de l'échec (`failure`), jamais une phrase toute
faite : le texte et le rôle ARIA sont décidés dans un module pur, donc testables
sans React ni jsdom — la même stratégie que `itinerary-cards.ts`.

### Le 404 « aucun trajet » du diagramme

Le flux de référence (CLAUDE.md §4, étape 5) prévoit un **404 si aucun trajet**.
Notre API ne le renvoie pas, et c'est assumé : depuis UF-402 elle répond `200`
avec une liste vide **et** l'état des sources. Un corps d'erreur 404 ne
transporterait pas cette nuance, et l'écran perdrait le seul moyen qu'il a de
distinguer « rien à proposer » de « personne n'a répondu ».

Le client traite quand même le 404 — un proxy ou une `NEXT_PUBLIC_API_URL` mal
réglée peut le produire sans que l'API en sache rien. Il tombe alors dans le cas
« résultat vide », pas dans le cas « panne » : afficher « vérifiez votre
connexion » à quelqu'un dont la recherche a simplement abouti à rien serait faux.

### Le 401 en cours d'usage

Rien de neuf n'est câblé : l'intercepteur d'UF-106 (`setUnauthorizedHandler` →
`SessionProvider`) purge la session et redirige vers `/login` en mémorisant la
page. Ce que UF-405 ajoute, c'est de **ne plus mentir** entre-temps : avant, un
401 affichait « vérifiez votre connexion » pendant la demi-seconde qui précédait
la redirection. Il affiche maintenant la vraie raison, en `role="status"` — un
`alert` couperait la parole au lecteur d'écran juste avant de changer de page,
sans rien lui apprendre.

### L'attente : squelette, pas spinner

Le calcul dure le temps de la source la plus lente (~2 à 8 s selon la charge
d'OpenTripPlanner). Un spinner laisserait la colonne s'effondrer puis se remplir
d'un coup, et la carte à droite sauterait. Le squelette **réserve la place** des
cartes à venir : la mise en page ne bouge plus à l'arrivée de la réponse (C2, pas
de reflow inutile — C5). Trois blocs et une pulsation d'opacité, aucune image.

Il est en `aria-hidden` : l'attente est déjà annoncée par le formulaire (bouton
« Calcul en cours… » + `role="status"` masqué). Deux régions vivantes pour la
même attente la feraient énoncer deux fois (WCAG 4.1.3).

Les résultats précédents sont écartés **au départ** de la recherche, pas à
l'arrivée de la suivante : sinon le panneau afficherait un squelette pendant que
la carte garde les anciens tracés, et une option périmée resterait cliquable.

### Le contraste des bandeaux (C7)

Un bandeau pose du **texte courant** sur un fond teinté : le seuil applicable est
4.5:1 entre les deux tokens, pas celui de la couleur seule sur blanc que
vérifiait UF-007. Les trois teintes ont donc rejoint le miroir
`lib/design-tokens.ts`, et un test y contrôle les trois couples.

C'est ce test qui a écarté `text-gold` du bandeau de mode dégradé : 4.28:1 sur
Gold 100. Le badge « récompense » s'en accommode à 12 px gras, un paragraphe de
14 px non — la note porte donc `text-warning` (5.73:1), qui est de toute façon la
couleur système du bon sens ici.

### Ce que les messages ne disent jamais (C11)

Ni statut HTTP, ni cause technique (`timeout`, `upstream-error`), ni nom de
service. Le bandeau de mode dégradé nomme les sources absentes en français
(« vélos et trottinettes en libre-service »), pas leur protocole : il s'adresse à
un usager, pas à un intégrateur. Deux tests de `plan-feedback.test.ts` verrouillent
cette règle.

## Détail de l'empreinte carbone (UF-501) — C2 / C5 / C7

Le panneau de résultats affichait « 🌱 240 g CO₂ » sans dire d'où venait le
chiffre. Depuis UF-501, l'API publie le détail (`Itinerary.carbon`) et l'écran
l'ouvre sous l'option retenue :

```
▸ D'où vient cette empreinte ?                       392 g CO₂
  🚶 Marche                                              0 g CO₂
  ▏
  Part-Dieu → Saxe                              400 m · 0 g/km

  🚌 Bus C3                                            380 g CO₂
  ██████████████████████████████████████████████
  Saxe → Bellecour                              4 km · 95 g/km

  🚗 Seul en voiture : 1,0 kg CO₂ — vous en évitez 632 g (62 %).
  Facteurs : ordres de grandeur de la Base Empreinte de l'ADEME.
```

### Le facteur est affiché

« 95 g/km » à côté de « 380 g CO₂ » : sur quatre kilomètres, le chiffre se refait
de tête. Sans lui, l'empreinte est à croire sur parole — et c'est la promesse
d'un calcul carbone transparent qui tombe. La source du barème est citée sous le
tableau, parce qu'un barème carbone non sourcé n'engage personne, et que c'est
sur lui que l'app demande à l'usager de changer ses habitudes.

### Sous la liste, pas dans la carte

Une carte de résultat est un `<label>` de bouton radio : y imbriquer un
`<summary>` cliquable ferait basculer la sélection à chaque ouverture du détail.
Le panneau vit donc **sous** la liste et suit la sélection — ce qui a un second
mérite, un seul détail ouvert à la fois, celui qui intéresse.

Il est **replié par défaut** : le panneau sert à comparer des options, le détail
d'une seule ne doit pas repousser les autres hors de l'écran (C2). Un `<details>`
natif porte cet état sans une ligne de JavaScript et donne gratuitement
l'ouverture au clavier et l'annonce « développé / réduit ».

### Rien n'est recalculé côté client (C5)

Tous les grammes viennent de la réponse. Le seul calcul local est le
**pourcentage de largeur** des barres, qui ne sort jamais de l'écran. Refaire une
multiplication que l'API vient de faire garantirait qu'un jour les deux
divergeront, et ferait payer au navigateur un travail déjà fait.

### Accessibilité (C7)

Le tableau visuel est intégralement en `aria-hidden` et doublé d'une phrase en
`sr-only` : « Détail de l'empreinte : 392 g CO₂ au total. Marche, 400 m à 0 g/km,
0 g CO₂ ; Bus C3, 4 km à 95 g/km, 380 g CO₂. Le même trajet seul en voiture
aurait émis 1,0 kg CO₂, soit 632 g évités. » Énoncé cellule par cellule, le
tableau donnerait une suite de nombres sans verbe (WCAG 1.1.1).

Les couleurs de modes sont portées par des **pastilles** et par les barres, pas
par du texte : elles sont validées au seuil des objets graphiques (3:1), pas à
celui du texte courant — la même règle que la carte de résultat. Elles restent
redondantes : le pictogramme et le libellé écrit disent déjà le mode.

---

## Badge CO₂ sur les cartes de résultat (UF-504) — C2 / C5 / C7

UF-404 avait rempli l'emplacement du badge réservé par la maquette : chaque carte
affichait déjà « 🌱 240 g CO₂ ». Ce qui manquait n'était pas la valeur, c'était
son **sens** — 240 g, c'est bien ou c'est mal ? Et le badge était vert quel que
soit le trajet, y compris sur un itinéraire tout-bus : un satisfecit décerné à
tout ce qui passe ne distingue plus rien.

```
┌──────────────────────────────────────────────┐
│ ● [🌱 Choix vert]                     22 min │
│ 🚶 3 › 🚲 11 › 🚌 C3 6 › 🚶 2                │
│ (🌱 240 g CO₂) −89 % vs voiture   ♿   09:41 │  ← vert : très faible empreinte
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ ● [⚡ Le plus rapide]                 18 min │
│ 🚶 2 › 🚌 C3 14 › 🚶 2                       │
│ (🍂 980 g CO₂) −55 % vs voiture       09:38  │  ← gold : empreinte modérée
└──────────────────────────────────────────────┘
```

### Le niveau se lit sur le rapport à la voiture, jamais sur les grammes

C'est la décision structurante du ticket. Un seuil en grammes absolus — « vert
sous 200 g » — classerait les trajets par **longueur** bien plus que par vertu :
un long trajet en métro à travers la métropole émet plus de grammes qu'une courte
course en bus tout en étant incomparablement plus sobre, et finirait peint en
rouge. Le niveau est donc lu sur `totalGrams / carEquivalentGrams`, le rapport à
ce que la **même distance** aurait coûté seul en voiture (UF-501). La distance
se simplifie, il ne reste que les modes.

| Part de la référence voiture | Niveau     | Teinte de la charte           | Mode qui y tombe                       |
| ---------------------------- | ---------- | ----------------------------- | -------------------------------------- |
| ≤ 20 %                       | `low`      | `tint-green` / `primary-dark` | marche, vélo, tram, métro, trottinette |
| ≤ 50 %                       | `moderate` | `tint-gold` / `warning`       | bus thermique, covoiturage             |
| > 50 %                       | `high`     | `tint-red` / `error`          | itinéraires mixtes très motorisés      |

Les bornes ne sont pas des dixièmes ronds choisis à vue : 20 % laisse la
trottinette (≈ 11 % de la voiture) du bon côté sans y faire entrer le bus
(≈ 44 %), et 50 % dit « vous avez au moins divisé par deux ». Aucun mode du
catalogue n'atteint `high` à lui seul aujourd'hui — le niveau existe pour les
itinéraires mixtes, et pour que l'écran ne mente pas si le barème évolue.

Les trois couples fond/texte viennent du bloc « Badges — états & modes » de la
charte (UF-007) : ce sont ceux de « ✓ Acquis », « ★ Récompense » et
« ⚠ Perturbation ». Aucune couleur n'a été inventée pour ce ticket.

### Quatre signaux pour une seule information (C7 — WCAG 1.4.1)

La teinte ne porte jamais le niveau seule :

| Signal                           | Pour qui                                                 |
| -------------------------------- | -------------------------------------------------------- |
| Teinte du fond                   | le balayage visuel, d'une carte à l'autre                |
| Pictogramme (🌱 / 🍂 / 🔥)       | qui ne distingue pas le vert du gold                     |
| « −89 % vs voiture »             | qui veut le chiffre — et le repère que demande le ticket |
| Niveau nommé dans l'`aria-label` | les technologies d'assistance                            |

Le pourcentage est le repère qui rend l'empreinte _parlante_ : « 240 g » ne dit à
personne si c'est bien ou mal, « 89 % de moins qu'en voiture » se comprend sans
connaître la Base Empreinte de l'ADEME. Il est lu sur `avoidedGrams`, que l'API
publie déjà borné à zéro — refaire la soustraction côté client rouvrirait le cas
d'une « économie négative » que le serveur a fermé.

Les trois couples sont vérifiés au seuil AA du **texte courant sur fond teinté**
(4,5:1) par `carbon-badge.test.ts`, et non au seuil de la couleur sur blanc :
c'est ce test qui impose `text-warning` (#8a5300) plutôt que `text-gold`
(4,28:1 sur Gold 100), comme pour les bandeaux d'UF-405.

### Cohérence avec le « choix vert » d'UF-503 (recette 4)

Deux pastilles vertes coexistent sur la meilleure carte, et c'est voulu — elles
ne disent pas la même chose :

| Badge             | Nature  | Ce qu'il affirme                     |
| ----------------- | ------- | ------------------------------------ |
| 🌱 **Choix vert** | relatif | « c'est le meilleur des quatre »     |
| 🌱 240 g CO₂      | absolu  | « et voici ce que ce meilleur vaut » |

La hiérarchie visuelle les sépare : le premier est une pastille **pleine** en
haut de carte, le second une pastille **teintée** en bas, avec les infos
secondaires. Une liste où toutes les options seraient mauvaises affichera donc un
« choix vert » portant une pastille rouge — ce n'est pas une incohérence, c'est
précisément ce qu'il faut montrer.

### Quand le niveau ne peut pas être établi

Un itinéraire servi depuis un cache antérieur à UF-501 ne porte pas de champ
`carbon`, donc pas de référence voiture, donc pas de dénominateur. La pastille
passe alors au **gris neutre** de la charte, sans pourcentage, et l'`aria-label`
énonce la valeur seule. Le repli est un aveu d'ignorance, pas une note : peindre
en vert « par défaut » — ce que faisait UF-404 — reviendrait à qualifier un
trajet dont on ne sait rien (C10).

### Rien n'est recalculé côté client (C5)

Le total et la référence viennent tous deux de la réponse. Le seul chiffre
fabriqué ici est le **pourcentage d'affichage**, qui ne sort jamais de l'écran —
même règle que les barres du détail carbone.

### Mobile (C2)

La pastille et son pourcentage vivent dans la ligne d'infos secondaires, en
`flex-wrap` : sur un écran de 320 px la comparaison passe sous la pastille
plutôt que de déborder, et la pastille elle-même ne se coupe jamais. Le détail
segment par segment reste hors de la carte, sous la liste, et replié par défaut
(`CarbonBreakdown`, UF-501) — le panneau sert à comparer, pas à tout déplier.

## Résultats hors-ligne (UF-601) — C1 / C10 / C7

Le planificateur est le seul écran dont les **données** survivent à la coupure :
le service worker mémorise chaque réponse réussie de `POST /routes/plan` et la
rejoue quand le réseau manque. Stratégies de cache complètes, schéma du flux et
recette : [`docs/pwa-offline.md`](../../../../docs/pwa-offline.md).

### Ce que le planificateur ajoute au dispositif

| Élément                                        | Rôle                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `useRoutePlan().servedFromCache`               | Publie la **provenance** des résultats affichés                     |
| `CACHED_ROUTE_NOTICE` (`lib/plan-feedback.ts`) | Le texte « recherche précédente », en ton `warning`                 |
| `PLAN_FAILURE_NOTICES.offline`                 | Hors-ligne **sans** itinéraire en cache — ton `status`, pas `alert` |

### Dire d'où viennent les résultats n'est pas facultatif

Une réponse rejouée est un `200` en tout point identique à la vraie. Sans le
bandeau, quelqu'un qui saisit deux adresses dans un tunnel lirait le trajet
**précédent** en croyant lire le sien — et descendrait au mauvais arrêt. C'est la
seule chose qui sépare une dégradation gracieuse d'un mensonge à l'écran.

### L'historique n'est pas complété sur un résultat rejoué

La réponse en cache porte le `searchHistoryId` de la recherche précédente.
`use-route-plan.ts` l'écarte explicitement : retenir un itinéraire inscrirait le
choix sur un trajet que l'usager n'a pas demandé et gonflerait son bilan carbone
de déplacements qui n'ont pas eu lieu — la règle est la même qu'à UF-505, où
seule une **décision** est enregistrée. La recherche courante, elle, n'a jamais
atteint l'API et n'existe pas en base.

### « Hors-ligne » ne se dit pas comme « indisponible »

`classifyPlanFailure` reçoit désormais `navigator.onLine`. Un échec réseau alors
que l'appareil se sait déconnecté devient `offline` : le message ne demande pas
de « vérifier votre connexion » — elle est déjà connue pour absente — et n'est
pas peint en rouge, puisqu'il n'y a rien à réparer avant le retour du réseau.
Les erreurs qui viennent de notre **contrat** (401, 400, 404) gardent leur sens
même hors-ligne : ce sont des réponses lues, pas des suppositions.

## Filtre d'accessibilité PMR annoncé à l'écran (UF-602) — C7 / C12

Le filtre PMR agissait depuis UF-302/UF-401, **sans que rien à l'écran ne le
dise**. Un usager en fauteuil qui obtenait une option au lieu de quatre ne pouvait
pas savoir si le réseau était pauvre ou si son propre réglage — coché peut-être
des semaines plus tôt, sur la page profil — avait écarté le reste. C'est le même
défaut que d'afficher une liste filtrée en cachant le filtre actif (WCAG 3.3.1).

`POST /routes/plan` publie désormais `appliedConstraints`, que `use-route-plan`
remonte tel quel et que `plan-feedback.ts` traduit en deux messages distincts :

| Situation                    | Message                                                             | Rôle     |
| ---------------------------- | ------------------------------------------------------------------- | -------- |
| Liste non vide, filtre actif | « Filtre accessibilité actif : seuls les itinéraires praticables… » | `status` |
| Liste vide, filtre actif     | « Aucun itinéraire praticable en fauteuil roulant… décochez… »      | `status` |
| Liste vide, aucune source    | « Aucune de nos sources n'a répondu » — la panne l'emporte          | `alert`  |

### Pourquoi jamais les deux à la fois

Sur une liste vide, le message de `describeEmptyResult` **contient déjà** la
mention du filtre — et mieux, puisqu'il explique le vide au lieu de le constater.
Afficher en plus la note « filtre actif » ferait lire deux fois la même
contrainte, dont une fois sans rien apprendre.

### Pourquoi un ton `info`, pas `warning`

La contrainte fait exactement ce qu'on lui demande : il n'y a **rien à corriger**.
La peindre en orange ferait chercher un problème dans un réglage volontaire, et
suggérerait de le retirer — ce qui n'est pas notre rôle. Le message dit seulement
où le changer, pour qui le voudrait.

### Le champ absent ne vaut pas « aucun filtre »

Une réponse rejouée depuis un cache antérieur à ce ticket ne porte pas
`appliedConstraints`. Le hook publie alors `null` — pas `{ reducedMobility: false }` :
prêter « aucun filtre » à une réponse qui n'en sait rien masquerait un filtre
peut-être bien actif (C10).

## Accès invité (UF-801) — C2 / C7 / C8

Le planificateur est **utilisable sans compte**. Chercher, comparer et lancer un
itinéraire est le service que la collectivité rend à tout le monde ; le réserver
aux inscrits revenait à faire payer en données personnelles une information
publique (C8), et à placer un formulaire d'inscription entre l'usager et son bus.

### Ce qui change, et ce qui ne change pas

|                             | Visiteur            | Connecté           |
| --------------------------- | ------------------- | ------------------ |
| Recherche, carte, résultats | identiques          | identiques         |
| Préférences appliquées      | défauts (« écolo ») | profil de mobilité |
| Trajets récents             | absents             | UF-204             |
| Suivi carbone               | absent              | UF-505             |

Il n'existe pas de version au rabais du planificateur : les trois sources sont
interrogées pareil et l'empreinte est calculée au même barème. Seule la
**mémoire** manque, et c'est exactement ce que la note dit à l'écran.

### Les trois verrous levés, et pourquoi ils n'ont pas été levés au même endroit

1. **API** — `POST /routes/plan` passe en `@OptionalAuth()` (voir
   `apps/api/src/modules/routes/README.md`). Un jeton valide renseigne toujours
   l'identité ; c'est ce que `@Public()` n'aurait pas su faire.
2. **Navigation** — `/` rejoint `OPEN_PATHS` dans `lib/session.ts`. Le
   middleware ne détourne plus l'accueil vers `/login`, et `/impact` comme
   `/profil` restent privés : le ticket ouvre une page nommée, il n'assouplit
   pas la règle du « privé par défaut ».
3. **Intercepteur 401** — `SessionProvider` ignore un 401 quand **aucune session
   n'est connue**. Sans cela, la première réponse `401` d'une route privée
   enverrait un visiteur qui ne s'est jamais connecté sur un écran de
   reconnexion — un cul-de-sac sur l'écran qu'on vient d'ouvrir.

### Le cookie mort, ou pourquoi le middleware efface quelque chose

Avant UF-801, un cookie expiré n'allait jamais loin : la page suivante était
privée, le middleware redirigeait vers `/login`, la reconnexion réécrivait le
cookie. Maintenant que `/` est public, ce visiteur atteint l'écran — mais son
navigateur continue de joindre le jeton mort à chaque appel, et l'API refuse un
jeton **présenté** et invalide (délibérément : une session morte doit se dire).
Il se retrouverait devant un planificateur ouvert qui refuse de calculer, sans
rien à déconnecter pour en sortir.

Le middleware efface donc ce cookie au passage. La requête suivante ne présente
plus rien, et l'API la sert comme celle de n'importe quel visiteur.

### La note à l'écran

`GUEST_MODE_NOTICE` (`lib/plan-feedback.ts`), rendue par `PlanNotice` en ton
`info` et rôle `status` : rien n'est cassé, rien n'est refusé, il n'y a aucune
raison de couper la parole à un lecteur d'écran (C7 — WCAG 4.1.3).

Elle annonce ce qui **manque** — les recherches ne sont pas conservées, le bilan
carbone n'est pas suivi — et non ce qui est permis : le visiteur voit déjà que
la recherche fonctionne. Ce qu'il ne peut pas deviner, c'est que ses trajets ne
sont gardés nulle part, et il vaut mieux qu'il l'apprenne avant de compter
dessus. Le message est une information, jamais un péage : laisser entendre qu'un
compte est nécessaire pousserait à en créer un pour un service déjà rendu — une
collecte obtenue par malentendu (C8).

L'invitation à se connecter est un **lien** posé sous le message, pas une phrase
dans le message : « connectez-vous » sans cible obligerait à repartir chercher
le bouton dans l'en-tête (C7 — WCAG 2.4.4). Le lien « Itinéraires » de
l'en-tête devient d'ailleurs visible aux visiteurs pour la même raison — sans
lui, un visiteur parti lire la politique de confidentialité n'aurait aucun
chemin de retour.

### Recette

| Recette du ticket                                 | Test                                                       |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Un visiteur atteint le planificateur, plus de 401 | `middleware.test.ts`, `jwt-auth.guard.spec.ts`             |
| Un connecté conserve son parcours complet         | `jwt-auth.guard.spec.ts`, `routes.service.spec.ts`         |
| Historique / carbone / profil restent fermés      | `middleware.test.ts`, `session.test.ts`                    |
| Pas de régression à la connexion                  | `routes.service.spec.ts` (invité ≡ connecté, sans mémoire) |
