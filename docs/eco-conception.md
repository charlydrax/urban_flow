# Éco-conception & performances (UF-605)

Référence des choix d'éco-conception d'UrbanFlow : **ce qui a été mesuré, avec quel
outil, ce que ça a donné, et ce qui a été décidé en conséquence**. Sert de support à
la partie « contraintes techniques » du dossier T6.

Contraintes couvertes : **C5** (éco-conception), **C10** (performances sous
connectivité variable), et par effet de bord **C1** (le cache PWA évite des requêtes)
et **C2** (pas de décalage de mise en page).

Code : [`apps/api/src/common/compression.ts`](../apps/api/src/common/compression.ts),
[`apps/web/scripts/eco-budget.mjs`](../apps/web/scripts/eco-budget.mjs),
[`apps/web/eco-budget.json`](../apps/web/eco-budget.json).

Mesures réalisées le **29/08/2026**, sur build de production, machine de développement.

---

## 1. Le principe directeur

Une application qui promeut la mobilité douce et qui gaspille des octets se
contredit elle-même. L'argument n'est pas seulement moral : le poste de
consommation dominant d'un smartphone en déplacement est **la radio**, pas
l'écran. Chaque kilo-octet évité est de l'énergie économisée sur l'appareil de
l'usager, sur le réseau de l'opérateur, et dans le datacenter.

D'où la règle appliquée dans tout ce document : **l'octet le plus sobre est celui
qu'on n'envoie pas**, et le calcul le plus sobre est celui qu'on ne fait pas.

Corollaire méthodologique, tout aussi important : **rien n'est affirmé ici sans
mesure**. Une optimisation non mesurée est une croyance, et les sections qui
suivent contiennent aussi ce qui _n'a pas_ marché.

---

## 2. Comment mesurer (reproductible)

### 2.1 Poids des pages — `npm run eco:budget`

```bash
cd apps/web
npm run eco:budget                # build isolé + mesure + vérification du budget
npm run eco:budget -- --no-build  # remesure la dernière sortie
npm run eco:budget -- --update    # réécrit les budgets après une hausse justifiée
```

Le script mesure le **poids gzip réellement transféré** (JS + CSS) au premier
chargement d'une page, cache vide. Deux écarts volontaires avec le tableau
qu'affiche `next build` :

- le **CSS est compté**, alors que Next l'exclut de son « First Load JS » — il est
  pourtant bloquant au rendu et arrive par la même connexion ;
- la mesure est faite **en gzip**, pas en brotli : c'est le plancher garanti par
  tous les navigateurs et tous les hébergeurs. Un budget doit être pessimiste.

Le build sort dans `.next-eco/` et non `.next/` : les deux répertoires sont
partagés avec `npm run dev`, et bâtir par-dessus un serveur de développement en
cours lui retire ses chunks sous les pieds. La mesure reste donc lançable à tout
moment — condition pour qu'elle soit lancée tout court.

Un dépassement de budget **fait échouer la commande** (code de sortie 1), avec le
nom de la route et l'écart. Même logique que l'audit d'accessibilité d'UF-602 :
une contrainte qui ne casse rien finit par ne plus être vérifiée.

### 2.2 Lighthouse — profil mobile

```bash
# 1. build de mesure, puis serveur de production sur un port libre
cd apps/web
NEXT_DIST_DIR=.next-eco npx next build
NEXT_DIST_DIR=.next-eco npx next start -p 3100

# 2. audit (profil mobile par défaut : Moto G Power, CPU ralenti ×4, réseau simulé)
npx lighthouse http://localhost:3100/login --only-categories=performance --view
```

Mesurer sur `npm run dev` n'a **aucun sens** : le serveur de développement ne
minifie pas, recompile à la volée et injecte l'outillage de rafraîchissement. Les
scores y sont faux, et faussement mauvais.

### 2.3 Poids des réponses d'API

```bash
curl -s -o /dev/null -w '%{size_download}\n' \
  -H 'Accept-Encoding: gzip' -b cookies.txt \
  -X POST http://localhost:3001/api/routes/plan \
  -H 'Content-Type: application/json' \
  -d '{"from":{...},"to":{...}}'
```

---

## 3. Ce qui a été mesuré

### 3.1 Poids des pages (gzip, premier chargement, cache vide)

Mesures du 30/08/2026, après la refonte de navigation d'UF-803 (§4.3).

| Route               |       JS |    CSS |        Total |
| ------------------- | -------: | -----: | -----------: |
| `/` (planificateur) | 125,1 ko | 7,4 ko | **132,4 ko** |
| `/profil`           | 115,4 ko | 7,4 ko |     122,8 ko |
| `/impact`           | 114,4 ko | 7,4 ko |     121,8 ko |
| `/register`         | 113,1 ko | 7,4 ko |     120,4 ko |
| `/login`            | 111,7 ko | 7,4 ko |     119,0 ko |
| `/confidentialite`  | 109,5 ko | 7,4 ko |     116,8 ko |

**Lecture** : environ **109 ko de socle commun** (React 19 + runtime Next.js et,
depuis UF-803, la navigation elle-même), identique sur toutes les pages, et **7 à
22 ko de code applicatif** par écran.
Le socle est le plancher du framework : il n'est pas réductible sans changer de
framework, ce qui n'est pas une décision de ticket.

Le fait que la page la plus lourde du produit reste **sous les 135 ko** tient à un
choix antérieur qui vaut d'être souligné : **MapLibre (~250 ko gzip) n'est dans
aucune de ces lignes**. Il est chargé dynamiquement (`apps/web/components/map/lazy-map.tsx`),
et sa feuille de style l'accompagne dans le même morceau — d'où un CSS partagé de
6,9 ko seulement, là où un import global aurait imposé les 70 ko de
`maplibre-gl.css` à l'écran de connexion.

### 3.2 Lighthouse — score Performance, profil mobile

| Page                |  Score |   FCP |   LCP |      TBT |  CLS | Poids total |
| ------------------- | -----: | ----: | ----: | -------: | ---: | ----------: |
| `/impact`           | **96** | 0,9 s | 1,2 s |   226 ms | 0,01 |      205 ko |
| `/login`            | **93** | 1,8 s | 3,0 s |    92 ms | 0,00 |      210 ko |
| `/profil`           | **90** | 1,5 s | 2,6 s |   287 ms | 0,07 |      207 ko |
| `/` (planificateur) | **68** | 1,1 s | 2,2 s | 5 600 ms | 0,00 |      495 ko |

**CLS à 0 sur le planificateur** n'est pas un hasard : la hauteur de la carte est
réservée par l'enveloppe `LazyMap` _avant_ l'arrivée de MapLibre. Sans cette
réserve, l'apparition de la carte décalerait toute la page sous les yeux de
l'usager.

**Le score de 68 sur `/` est analysé en §5** — c'est le seul résultat du ticket qui
ne soit pas satisfaisant, et il a une cause unique et identifiée.

### 3.3 Poids des réponses d'API — avant / après compression

| Endpoint                           |    Avant |       Après |                Gain |
| ---------------------------------- | -------: | ----------: | ------------------: |
| `POST /api/routes/plan`            | 10 624 o | **1 585 o** |         **−85,1 %** |
| `GET /api/search-history?limit=10` |  1 981 o |   **654 o** |             −67,0 % |
| `GET /api/carbon/summary`          |    926 o |       926 o |   — (sous le seuil) |
| `GET /api/users/me`                |    287 o |       287 o |   — (sous le seuil) |
| `POST /api/auth/login`             |    329 o |       329 o | — (exclu, cf. §4.1) |

---

## 4. Ce qui a été fait dans ce ticket

### 4.1 Compression des réponses de l'API — le gain principal

L'API ne comprimait rien : elle ne posait aucun `Content-Encoding`, alors que
Next.js comprimait déjà le front depuis toujours. C'était l'écart le plus coûteux
du système, et il portait précisément sur la réponse la plus lourde.

`POST /routes/plan` renvoie du JSON très répétitif — mêmes clés sur chaque
segment, coordonnées voisines les unes des autres. C'est la forme de données que
gzip réduit le mieux : **10 624 o → 1 585 o, soit 85 % de trafic en moins** pour
quelques millisecondes de CPU.

Ce que ça change sur le terrain d'usage du produit, en temps de transfert seul :

| Débit                    |  Avant | Après |
| ------------------------ | -----: | ----: |
| 3G lent (~400 kbit/s)    | 213 ms | 32 ms |
| 4G dégradé (~1,6 Mbit/s) |  53 ms |  8 ms |

**Deux garde-fous**, tous deux dans [`common/compression.ts`](../apps/api/src/common/compression.ts) :

- **Seuil à 1 024 o.** En dessous, l'en-tête gzip coûte plus que ce qu'il
  économise : on dépenserait du CPU des deux côtés du réseau pour transporter
  _plus_ d'octets. La sobriété, ici, c'est de ne rien faire.
- **`/auth/login` et `/auth/register` ne sont jamais comprimés.** Ces réponses
  portent un `accessToken` dans leur corps ; comprimer une réponse qui contient
  un secret et dont une partie est influençable par un attaquant, c'est le motif
  d'attaque **BREACH** — la taille comprimée fuit alors le secret, octet par
  octet. L'exclusion est écrite par chemin plutôt que laissée au hasard du seuil :
  ces réponses passent aujourd'hui sous 1 ko, mais un champ de plus suffirait à
  les faire basculer, silencieusement. Une protection qui dépend d'une taille
  qu'on ne contrôle pas n'est pas une protection.

La politique est un module **pur**, testé en isolation
([`compression.spec.ts`](../apps/api/src/common/compression.spec.ts), 7 cas) : ce
qui nous appartient et qui doit casser si on le change par inadvertance, c'est la
liste des exclusions — pas le fonctionnement de la bibliothèque.

### 4.2 Appel réseau redondant : la revalidation de session

Audit des parcours clés, requête par requête (onglet Réseau, cache vide) :

| Parcours                         |                Requêtes | Verdict                                                     |
| -------------------------------- | ----------------------: | ----------------------------------------------------------- |
| Connexion → planificateur        |     1 login + 1 session | nominal                                                     |
| Saisie « bellecour » (9 lettres) |         **1** géocodage | débounce 300 ms (UF-203)                                    |
| Recherche d'itinéraire           |                1 `plan` | l'historique est alimenté par la réponse, sans second appel |
| Sélection d'un itinéraire        |               1 `PATCH` | —                                                           |
| Retour sur l'onglet              | ~~2~~ → **1** `session` | **corrigé par ce ticket**                                   |
| Écran `/impact`                  |             1 `summary` | ni polling ni rechargement au focus                         |

Un seul défaut trouvé, et corrigé : `SessionProvider` écoutait
`visibilitychange` **et** `focus` pour revalider la session au retour sur
l'onglet. Les deux événements sont nécessaires — aucun ne couvre l'autre :
`visibilitychange` rate le retour depuis une autre _application_, `focus` rate le
retour depuis un autre _onglet_ sur certains navigateurs. Mais dans le cas le
plus courant, revenir d'un autre onglet de la même fenêtre, **les deux se
déclenchent** à quelques millisecondes d'intervalle : c'étaient deux
`GET /auth/session` pour une seule question.

Correction : une fenêtre de coalescence de 2 secondes. Large au regard de l'écart
entre les deux événements, ridicule au regard de la durée de vie du JWT
(15 minutes) — elle ne peut donc pas masquer une expiration.

### 4.3 Un budget qui casse le build

Une mesure ponctuelle rassure un jour et se périme le lendemain. Les poids du
§3.1 sont figés dans [`eco-budget.json`](../apps/web/eco-budget.json) : une
dépendance ajoutée sans y penser fait désormais échouer `npm run eco:budget`,
avec la route et l'écart.

Tolérance de 512 octets au-dessus du budget : un build n'est pas parfaitement
déterministe, et un garde-fou qui crie au loup sur du bruit finit ignoré — le
pire sort possible pour un garde-fou.

#### Ce que le budget a effectivement attrapé (UF-803)

La refonte de la navigation a été la première hausse à passer devant ce
garde-fou, et il a servi deux fois plutôt qu'une.

**Le défaut qu'il a révélé : +3,5 ko sur huit routes, dont sept ne s'en
servaient pas.** Le rail de navigation affiche les initiales du compte connecté,
et appelait pour cela `initialsFromEmail` — une fonction de six lignes, mais
logée dans `features/profile/preferences.ts`. Or ce module importe
`RoutePriority` et `TransportMode` depuis `@urbanflow/shared` : des
**énumérations**, donc des valeurs d'exécution, pas des types effacés à la
compilation. Comme le rail est monté par le layout racine, tout cela est parti
dans le lot commun — la politique de confidentialité payait les libellés du
formulaire de profil.

La correction tient en un module feuille sans aucun import
([`apps/web/lib/initials.ts`](../apps/web/lib/initials.ts)) : **−1,8 ko sur
toutes les routes**. La leçon est plus large que le cas : _ce qu'un composant de
la coque importe est payé par chaque page, y compris celles qui ne l'affichent
jamais._ Une fonction utilitaire partagée entre une feature et la coque doit
vivre dans `lib/`, pas dans la feature.

Deuxième passe, même logique : `MobileBrandBar` n'a ni état ni gestionnaire
d'événement. Sortie du module `'use client'` d'`AppNav`, elle redevient un Server
Component — son balisage est rendu une fois côté serveur au lieu d'être
réexécuté dans le navigateur.

**La hausse résiduelle, elle, est assumée : +1,7 ko gzip de socle commun**
(+1,5 %). Elle achète une navigation réellement plus riche que l'en-tête qu'elle
remplace — quatre pictogrammes SVG, deux agencements (onglets / rail) et le bloc
de compte du rail — pour un coût inférieur à celui du seul détour d'import
corrigé ci-dessus. Les budgets ont été réajustés en conséquence
(`npm run eco:budget -- --update`).

---

## 5. Le point non résolu : MapLibre sur le planificateur

**Constat.** `/` obtient 68/100 en mobile, contre 90 à 96 pour toutes les autres
pages. Une seule métrique décroche : le **Total Blocking Time, à 5 600 ms**. Le
LCP (2,2 s) et le CLS (0) sont bons.

**Cause, mesurée et non supposée.** L'audit `bootup-time` de Lighthouse attribue
**6 649 ms de CPU** à un unique fichier : le morceau MapLibre (1 Mo brut,
267 ko transférés). Sous le ralentissement CPU ×4 du profil mobile, l'analyse et
le démarrage de la bibliothèque monopolisent le fil d'exécution principal. MapLibre
n'est pas seulement lourd à transférer : il est lourd à **démarrer**.

**Ce qui a été tenté, et qui n'a pas marché.** Monter la carte seulement quand
son conteneur approche de l'écran (`IntersectionObserver`), pour qu'un usager
mobile qui saisit son trajet sans faire défiler ne paie ni les octets ni le CPU.
Deux marges d'anticipation ont été essayées, 300 px puis 0 px, avec un build et
un audit complets à chaque fois. **Dans les deux cas, MapLibre se charge quand
même** : sur le gabarit mobile de Lighthouse (412 × 823), le conteneur de la
carte est déjà dans la fenêtre au premier rendu. La carte n'est pas sous la ligne
de flottaison — elle est _à_ la ligne de flottaison.

Le code de différé a donc été **retiré** plutôt que conservé : il n'aurait rien
économisé sur l'écran concerné, tout en laissant croire le contraire à sa
prochaine lecture. Un mécanisme inerte documenté comme une optimisation est pire
que pas de mécanisme du tout.

**Ce qui reste, et pourquoi c'est acceptable.** MapLibre est le cœur de la
fonctionnalité F2 : afficher un itinéraire sur une carte _est_ le produit. Le
chargement dynamique déjà en place fait ce qu'il peut — il épargne ces 267 ko à
**toutes les autres pages**, qui sont d'ailleurs celles où l'on entre dans
l'application (connexion, inscription). L'usager ne paie la carte que sur l'écran
qui l'utilise.

**Piste pour la suite, à arbitrer côté produit et non côté code.** Sur les petits
écrans, remplacer la carte au premier affichage par sa réserve visuelle et un
bouton « Afficher la carte ». L'usager arrive sur le planificateur pour _saisir un
trajet_ ; la carte ne lui sert qu'après. Le gain serait franc — 267 ko et
plusieurs secondes de CPU sur la première visite mobile. Ce n'est pas une
optimisation technique mais un **changement de parcours**, qui touche à la
maquette Figma : il demande une validation de conception, pas un commit.

---

## 6. Principes d'éco-conception appliqués (récapitulatif pour le dossier)

Les lignes marquées d'un ticket antérieur n'ont pas été faites dans UF-605 : elles
sont recensées ici parce que l'éco-conception est un résultat cumulé, pas une passe
finale.

| #   | Principe                                                | Mise en œuvre                                                                                                                                                                 | Ticket         |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | **Ne pas transférer ce qui ne sert pas**                | MapLibre et son CSS chargés dynamiquement, seulement sur les écrans à carte                                                                                                   | UF-201         |
| 2   | **Comprimer ce qu'on transfère**                        | gzip sur l'API (−85 % sur `/routes/plan`), déjà actif côté Next.js                                                                                                            | **UF-605**     |
| 3   | **Ne pas redemander ce qu'on a déjà**                   | mémoïsation GBFS par flux selon sa volatilité réelle (1 h pour le statique, 60 s pour le temps réel) ; fenêtre de service OTP en cache 1 h                                    | UF-301, UF-303 |
| 4   | **Ne pas appeler à chaque frappe**                      | débounce 300 ms + annulation `AbortController` sur l'autocomplétion : « bellecour » coûte 1 requête au lieu de 9                                                              | UF-203         |
| 5   | **Aucun polling**                                       | la session est revalidée sur événement (retour d'onglet), jamais périodiquement ; le bilan carbone se charge quand on le regarde                                              | UF-106, UF-505 |
| 6   | **Un appel redondant est un défaut**                    | coalescence de la double revalidation `visibilitychange` + `focus`                                                                                                            | **UF-605**     |
| 7   | **Servir depuis le cache quand c'est licite**           | assets de build en cache-first (immutables par hash), fond de carte en cache-first **borné à 250 tuiles**                                                                     | UF-601         |
| 8   | **Borner les caches**                                   | sans plafond, le cache de tuiles se fait évincer _en bloc_ par le navigateur et emporte le shell avec lui                                                                     | UF-601         |
| 9   | **Ne pas cacher les données personnelles**              | profil, historique et bilan carbone toujours réseau : un cache de service worker survit à la déconnexion (C8/C11)                                                             | UF-601         |
| 10  | **Transmettre la géométrie au bon niveau de précision** | `ST_AsGeoJSON` limité à 5 décimales (~1 m) ; les polylignes OTP sont décodées à la même échelle. La précision par défaut décrirait le millimètre et gonflerait chaque réponse | UF-304         |
| 11  | **Paralléliser plutôt qu'enchaîner**                    | `Promise.allSettled` sur OTP + GBFS + PostGIS, avec délai borné par source : une source lente ne retient pas les autres                                                       | UF-305         |
| 12  | **Ne pas relayer les rafales**                          | plafond de 60 calculs/minute et par IP sur `/routes/plan` : l'endpoint le plus coûteux est aussi une arme d'amplification contre nos fournisseurs de données                  | UF-604, UF-802 |
| 13  | **Typographies auto-hébergées**                         | `next/font` : aucune requête vers un CDN tiers au runtime (bénéfice RGPD au passage)                                                                                          | UF-007         |
| 14  | **Pas d'image là où le CSS suffit**                     | aucune image décorative dans le produit ; seules les icônes PWA (192/512) existent, et elles ne sont demandées qu'à l'installation                                            | UF-006         |
| 15  | **Réserver l'espace avant de le remplir**               | hauteur de carte portée par l'enveloppe, pas par le composant chargé → CLS mesuré à 0                                                                                         | UF-201         |
| 16  | **Une contrainte non vérifiée dérive**                  | budget de poids en échec de build, comme l'audit d'accessibilité en échec de test                                                                                             | **UF-605**     |
| 17  | **Sobriété jusque dans l'outillage**                    | suite unitaire en environnement `node`, jsdom réservé aux tests qui ont besoin d'un DOM (~1 s de démarrage par fichier économisée)                                            | UF-602         |

### Ce qui n'est délibérément **pas** fait

- **Pas de formats d'image modernes (WebP/AVIF)** ni de `next/image` : le produit
  n'affiche aucune photographie. Les seuls fichiers image sont les deux icônes
  PWA, demandées une fois à l'installation par le système. Mettre en place une
  chaîne d'optimisation d'images pour deux icônes serait de la dépendance pour
  rien — l'inverse de l'objectif.
- **Pas de cache sur `POST /routes/plan` côté serveur** : deux usagers ne
  partagent ni le même profil ni les mêmes contraintes d'accessibilité, et un
  itinéraire est périssable par nature. Le cache existe là où il est licite —
  dans le service worker, pour rejouer _le dernier_ itinéraire hors-ligne, et
  en le signalant à l'écran (UF-601).
- **Pas de mesure EcoIndex publiée** : l'outil note principalement le nombre de
  requêtes DOM, le poids et le nombre de requêtes réseau — trois grandeurs déjà
  couvertes ici par des mesures directes et reproductibles en local. Un score
  EcoIndex se calcule sur une URL publique ; il pourra être ajouté au dossier
  après mise en ligne, sans changer une ligne de code.

---

## 7. Temps de réponse sous connexion dégradée

Le poste dominant du temps de réponse de `POST /routes/plan` **n'est pas le
réseau** : c'est OpenTripPlanner. Mesures bout en bout depuis le client :

| Situation                                       |                                                 Durée |
| ----------------------------------------------- | ----------------------------------------------------: |
| Première requête, cache OTP froid               | 12,7 s (délai OTP atteint → source transport écartée) |
| Requêtes suivantes, fenêtre de service en cache |                                                 5,8 s |
| Transfert de la réponse, 3G lent                |               32 ms (contre 213 ms avant compression) |

Deux conséquences assumées, et déjà traitées ailleurs :

- **la dégradation gracieuse est la vraie réponse au réseau lent** — si OTP
  dépasse `OTP_TIMEOUT_MS` (12 s), la source est écartée et les itinéraires vélo
  et marche sont rendus quand même, avec un bandeau « mode dégradé » (UF-305,
  UF-405). Une réponse partielle en 6 secondes vaut mieux qu'une réponse complète
  qui n'arrive pas ;
- **le service worker couvre la coupure** — réseau perdu après un calcul, le
  dernier itinéraire est rejoué depuis le cache, et l'écran le dit (UF-601).

La lenteur d'OTP est une caractéristique de l'**environnement de développement**
(graphe GTFS reconstruit localement, miroir de données daté). Elle est documentée
comme telle dans [`otp-gtfs.md`](./otp-gtfs.md) et ne relève pas de ce ticket.

---

## 8. Vérifier que rien n'a régressé

```bash
# Poids des pages — échoue si une route dépasse son budget
cd apps/web && npm run eco:budget

# Politique de compression — exclusions BREACH et seuil
cd apps/api && npx jest src/common/compression.spec.ts

# Suites complètes
cd apps/web && npm test          # 305 tests (unitaires + accessibilité)
cd apps/api && npm test          # 337 tests
```
