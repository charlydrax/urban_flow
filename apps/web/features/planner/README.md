# Module `planner` — Planificateur d'itinéraires (F2)

Écran d'accueil de la PWA : saisie du trajet, géolocalisation consentie, carte.
Le calcul d'itinéraires lui-même (`POST /routes/plan`) arrive dans un ticket
ultérieur ; ce module en pose le formulaire et l'étape 1 du flux de référence.

Maquettes : Figma « 02 · Maquettes mobile → 1. ACCUEIL » et « 4. PLANIFICATEUR
F2 », « 03 · Maquettes desktop → DESKTOP 2 : PLANIFICATEUR ».

## Fichiers

| Fichier                    | Rôle                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| `planner-screen.tsx`       | Frontière client : partage la position entre le formulaire et la carte   |
| `planner-form.tsx`         | État du trajet, géolocalisation → départ, inversion, soumission          |
| `trip-fields.tsx`          | Carte départ/arrivée de la maquette + bouton d'inversion                 |
| `address-autocomplete.tsx` | Champ d'adresse au motif ARIA « combobox » + liste de suggestions        |
| `use-address-search.ts`    | Débounce 300 ms, annulation de la requête précédente, états de recherche |
| `locate-me.tsx`            | Bouton « Me localiser », panneau de consentement, comptes rendus         |
| `use-user-location.ts`     | Machine à états du parcours (consentement → permission → position)       |
| `../../lib/geocoding.ts`   | Appels BAN normalisés : recherche, géocodage inverse (pur, testé)        |
| `../../lib/geolocation.ts` | Appel `navigator.geolocation` normalisé + formats (pur, testé)           |

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

### Restreindre à Lyon : deux mécanismes, pas un

- **Biais** — `lat`/`lon` transmis à la BAN (centre de Lyon) : classe les
  homonymes par proximité. « république » remonte Lyon avant Paris.
- **Filtre** — `isWithinLyonArea` écarte ensuite ce qui tombe hors de l'emprise
  de la métropole. Le biais _classe_ mais ne _restreint_ pas : sur une saisie
  très ambiguë (« gare »), des adresses de toute la France remontent quand même.

L'emprise est volontairement large (les 59 communes du Grand Lyon et quelques
limitrophes) : refuser Villeurbanne, Bron ou Vénissieux rendrait l'outil inutile.

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

Les tests de composants (jsdom + Testing Library) restent à ajouter avec le
calcul d'itinéraires.
