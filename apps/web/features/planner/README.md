# Module `planner` — Planificateur d'itinéraires (F2)

Écran d'accueil de la PWA : saisie du trajet, géolocalisation consentie, carte.
Le calcul d'itinéraires lui-même (`POST /routes/plan`) arrive dans un ticket
ultérieur ; ce module en pose le formulaire et l'étape 1 du flux de référence.

Maquettes : Figma « 02 · Maquettes mobile → 1. ACCUEIL » et « 03 · Maquettes
desktop → DESKTOP 2 : PLANIFICATEUR ».

## Fichiers

| Fichier                    | Rôle                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `planner-screen.tsx`       | Frontière client : partage la position entre le formulaire et la carte |
| `planner-form.tsx`         | Champs départ/arrivée, pré-remplissage du départ                       |
| `locate-me.tsx`            | Bouton « Me localiser », panneau de consentement, comptes rendus       |
| `use-user-location.ts`     | Machine à états du parcours (consentement → permission → position)     |
| `../../lib/geolocation.ts` | Appel `navigator.geolocation` normalisé + formats (pur, testé)         |

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

- Le résultat est **écrit sous le bouton**, pas seulement posé sur la carte :
  coordonnées, précision, et messages d'erreur.
- Attente et succès en `role="status"`, échecs en `role="alert"`.
- Le panneau de consentement reçoit le focus à son apparition (WCAG 4.1.3) sans
  piéger la navigation clavier : ce n'est pas une modale.
- Le marqueur de position porte un `role="img"` et une étiquette incluant la
  précision ; le halo pulsé s'arrête sous `prefers-reduced-motion` (WCAG 2.3.3).

## Tests

```bash
cd apps/web && npm run test    # lib/geolocation.test.ts
```

Les tests couvrent la normalisation des trois cas d'échec, l'inversion
`lat/lng → [lng, lat]` (C9) et les formats affichés. Les tests de composants
(jsdom + Testing Library) restent à ajouter avec le calcul d'itinéraires.
