# Fusion en itinéraires multimodaux (UF-401)

Comment le Service Itinéraire transforme les données brutes des trois sources en
propositions de bout en bout. **Étape 5 du flux de référence** (CLAUDE.md §4), et
la pièce la plus algorithmique du projet.

Complète [`source-orchestration.md`](./source-orchestration.md), qui décrit
l'étape précédente — la collecte parallèle qui alimente cette fusion.

> Pour **observer** les données d'entrée de la fusion sur un trajet réel, voir
> [`source-diagnostics-endpoint.md`](./source-diagnostics-endpoint.md) (UF-306)
> et l'écran `/dev/sources`.

---

## 1. Le problème

À la fin de la collecte, on dispose de trois tas de données qui ne se parlent
pas :

| Source           | Ce qu'elle a rendu                                          |
| ---------------- | ----------------------------------------------------------- |
| `transit`        | des trajets porte-à-porte complets, calculés par OTP        |
| `sharedMobility` | des **bornes** aux deux extrémités, avec leur disponibilité |
| `cyclePaths`     | des **tronçons** cyclables aux deux extrémités              |

Un itinéraire, lui, est une **chaîne continue** : marche jusqu'à une borne, vélo
jusqu'à un arrêt, tram, marche jusqu'à l'arrivée. Personne ne fournit cette
chaîne — il faut la fabriquer, et c'est le sujet de ce document.

## 2. Quatre familles de propositions

```
mergeIntoItineraries(sources, from, to, prefs) → { itineraries, sortedBy }
```

| Famille        | Chaîne                      | Source nécessaire            | Ce qu'elle apporte                             |
| -------------- | --------------------------- | ---------------------------- | ---------------------------------------------- |
| `transit`      | marche → TC → marche        | `transit`                    | la référence, calculée sur le réseau réel      |
| `bike-transit` | marche → vélo → TC → marche | `transit` + `sharedMobility` | supprime la longue marche d'accès ou de sortie |
| `bike`         | marche → vélo → marche      | `sharedMobility`             | porte-à-porte, sans attendre de véhicule       |
| `walk`         | marche                      | aucune                       | l'option évidente quand c'est court            |

Les familles sont **indépendantes** : chacune est tentée, chacune peut échouer
seule. C'est la traduction directe de la dégradation gracieuse (C10) au niveau de
la fusion — un opérateur de vélos muet retire deux familles sur quatre, il ne
vide pas la réponse.

## 3. Le tout-TC : rien n'est recalculé

Les trajets d'OpenTripPlanner sont repris **tels quels** : durées, distances et
tracés viennent du calcul sur le graphe réel. On ne réécrit que les deux
libellés d'extrémité — OTP nomme son point de départ « Origin », ce qui
n'apprendrait rien à quelqu'un qui vient de taper « Part-Dieu ». Les arrêts
intermédiaires gardent leur nom GTFS : c'est celui écrit sur le quai.

## 4. Le rabattement à vélo, et sa condition d'honnêteté

C'est la proposition la plus intéressante du planificateur, et la plus facile à
bâcler.

Un trajet TC commence et finit presque toujours à pied. Quand cette marche est
longue, un Vélo'v la raccourcit. Le piège serait de proposer « prenez un vélo
jusqu'à l'arrêt » sans savoir s'il existe une borne **où le rendre**.

La règle appliquée est donc stricte : le rabattement n'est construit que si les
**deux** bornes figurent dans les données collectées — celle où on prend le vélo,
et celle où on le rend, cette dernière à moins de 250 m de l'arrêt. Sinon, la
proposition n'existe pas.

### Un seul côté, le plus lourd

Rabattre à la fois au départ et à l'arrivée multiplierait les manipulations pour
un gain qui s'annule vite, et produirait une proposition illisible. On tente le
côté qui pèse le plus ; si les bornes manquent de ce côté, on tente l'autre.

### Et si ça ne fait pas gagner de temps ?

La proposition est écartée — **sauf** si la marche qu'elle remplace dépassait la
limite du profil. Dans ce cas elle rend praticable un trajet qui ne l'était pas,
ce qui vaut mieux qu'une minute gagnée.

### Conséquence sur la collecte

Le collecteur cherche les bornes dans un rayon de **900 m** pour la planification
(contre 500 m pour « les stations autour de moi »). Un arrêt d'embarquement à
sept cents mètres tomberait sinon hors du rayon, et le rabattement ne serait
jamais constructible.

Le surcoût réseau est **nul** (C5) : le connecteur GBFS télécharge et mémoïse les
flux entiers, puis filtre en mémoire. Élargir le rayon ne déclenche aucune
requête supplémentaire, seulement quelques haversines de plus.

## 5. La continuité, tenue par construction

Recette 2 du ticket : « chaque itinéraire est une chaîne continue de segments,
pas de trou géographique ».

Chaque portion en cours de construction (un `Step`) porte non seulement ses
libellés mais aussi les **coordonnées** de ses deux extrémités. C'est ce qui
permet de recoller les morceaux quand un rabattement remplace le début d'un
trajet TC, et de vérifier la continuité autrement que sur une chaîne de
caractères.

Le seul endroit où l'invariant pourrait se rompre est le nettoyage des portions
négligeables : une borne posée devant l'adresse de départ ne justifie pas un
segment « marchez 12 mètres ». Ces portions ne sont donc pas **supprimées** mais
**absorbées** par leur voisin, qui hérite du libellé et du point.

## 6. Les portions que nous fabriquons

Marche et vélo n'ont aucun moteur derrière : ils sont estimés dans
`travel-model.ts`, à partir d'une distance à vol d'oiseau, d'un facteur de détour
et d'une vitesse moyenne.

| Paramètre                       | Valeur    | Justification                                              |
| ------------------------------- | --------- | ---------------------------------------------------------- |
| Vitesse de marche               | 80 m/min  | 4,8 km/h — sous la vitesse de promenade : feux, traversées |
| Vitesse de vélo                 | 220 m/min | 13,2 km/h — vitesse _commerciale_, pas de pointe           |
| Prise + restitution du vélo     | 3 min     | coût **fixe**, qui pénalise les trajets courts             |
| Détour à pied                   | ×1,30     | tissu lyonnais en damier                                   |
| Détour à vélo, sans aménagement | ×1,45     | sens de circulation, quais, ponts                          |
| Détour à vélo, corridor aménagé | ×1,20     | on suit l'aménagement au lieu d'improviser                 |

Le temps de manipulation est compté **à part** plutôt que fondu dans la vitesse :
c'est lui qui empêche le planificateur de proposer un Vélo'v pour six cents
mètres, et le fondre ferait paraître un saut de puce plus rapide qu'il ne l'est.

Les valeurs sont volontairement **prudentes** : sur-estimer une marche de
rabattement fait perdre une option à l'usager, la sous-estimer lui fait rater son
tram.

## 7. Ce que les tronçons cyclables changent réellement

Le ticket demande d'« utiliser les tronçons cyclables PostGIS (UF-304) pour les
portions vélo/marche ». Voici comment, concrètement.

`cycle-coverage.ts` échantillonne le corridor entre les deux bornes (un point
tous les 50 m) et compte la part des points qui tombent à moins de 30 m d'un
aménagement connu. Cette part fait glisser le facteur de détour de 1,45 vers
1,20 : un corridor équipé se parcourt plus directement, donc plus vite.

### C'est une proximité, pas un calage sur le réseau

La mesure répond à « ce corridor est-il équipé ? », pas à « quel itinéraire
cyclable exact emprunter ? ». Un vrai calage (_map matching_) supposerait un
routeur cyclable et un graphe topologique ; à l'échelle de quelques centaines de
mètres, et pour un indicateur qui ne fait que départager deux propositions
plausibles, la proximité suffit — et elle coûte quelques dizaines de
microsecondes en mémoire, là où une requête `ST_LineSubstring` par candidat
ajouterait un aller-retour SQL à chaque recherche (C5).

### Deux biais connus, et pourquoi ils sont tolérables

- Un tronçon **perpendiculaire** au corridor le « couvre » sur un point : avec un
  pas de 50 m, il ne pèse presque rien.
- Les tronçons ne sont connus qu'**autour des extrémités** (rayon UF-304) : le
  milieu d'un long corridor est structurellement sous-estimé. La couverture est
  donc un indicateur **prudent** — on ne promet jamais un aménagement qu'on n'a
  pas vu, ce qui est le bon sens de l'erreur.

## 8. Les préférences du profil

Recette 3 : « les préférences du profil influencent les propositions ». Elles
n'agissent pas toutes de la même façon, et la distinction est raisonnée.

| Préférence        | Effet                | Pourquoi                                                                                                   |
| ----------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `reducedMobility` | **filtre dur** (C12) | ce n'est pas un goût mais une contrainte : proposer un trajet impraticable en fauteuil serait une faute    |
| `maxWalkMinutes`  | **filtre dur**       | c'est un maximum annoncé par l'usager ; le dépasser reviendrait à ignorer une valeur qu'il a saisie        |
| `preferredModes`  | **sélection**        | n'exclut rien : un profil « métro et vélo » ne doit pas rester sans réponse le jour où seul un bus circule |
| `priority`        | **tri publié**       | `carbonAsc` pour « écolo », `durationAsc` pour « rapide »                                                  |

`maxWalkMinutes` s'applique **par segment**, pas au total : c'est ce que dit le
profil (« durée de marche maximale acceptée par segment »), et c'est ce qui a du
sens — trois fois cinq minutes de marche ne fatiguent pas comme quinze minutes
d'affilée.

### La clé de tri est publiée

`sortedBy` fait partie de la réponse. Le client doit pouvoir annoncer « classés
par empreinte » ou « classés par durée » sans relire les préférences de l'usager
ni deviner l'ordre en comparant les valeurs lui-même.

## 9. Le plafond, et la diversité

Recette 4 : « le nombre d'itinéraires est plafonné ». Il l'est à **cinq**.

Mais un plafond seul ne suffit pas. Sans règle supplémentaire, trois variantes du
même métro — même ligne, départ décalé de quelques minutes — le rempliraient et
masqueraient l'option vélo. Or c'est précisément la comparaison **entre familles**
que le produit veut provoquer.

La sélection procède donc en deux temps :

1. le meilleur de **chaque famille** d'abord ;
2. le reste au mérite, jusqu'au plafond.

Le mérite combine, dans cet ordre : le respect des modes favoris du profil, puis
la priorité (rapide ou écologique). Deux propositions strictement équivalentes
(mêmes modes, mêmes lignes) sont par ailleurs dédoublonnées en amont — deux fois
le même trajet ne sont pas deux choix.

## 10. Ce que la fusion ne fait pas

- **Aucun appel réseau, aucune requête base.** Fonction pure : tout est déduit de
  `CollectedSources`. C'est ce qui permet de tester le cœur du produit sans OTP,
  sans flux GBFS et sans PostGIS.
- **Aucun barème carbone en propre.** Les facteurs vivent dans le Service Carbone
  (`carbon/emission-factors.ts`) ; la fusion s'en sert pour classer ses
  candidats, et c'est `CarbonService.computeFootprint` qui produit la valeur
  publiée (étape 6 du flux).
- **Aucun routage piéton ou cyclable.** Voir §6 : ce sont des estimations, et
  les tracés de ces portions sont des droites. Un routeur reste la bonne réponse
  le jour où le produit en aura un — le graphe OSM est déjà chargé dans OTP
  (UF-301).
- **Aucune écriture d'historique.** C'est l'étape 7, et elle appartient à UF-402.

## 11. Recette

```bash
cd dev
npm run test --workspace apps/api -- merge
```

`apps/api/src/modules/routes/merge/itinerary-merger.spec.ts` couvre les quatre
points du ticket sur le scénario nominal Part-Dieu → Bellecour, plus la
dégradation gracieuse source par source et les règles de bon sens (pas de vélo
sans borne de retour, pas de vélo sans vélo disponible).

| Recette du ticket                            | Test                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| plusieurs itinéraires multimodaux distincts  | `proposes several distinct multimodal itineraries for a Lyon trip`                                                                   |
| chaîne continue, pas de trou géographique    | `chains every itinerary end to end, with no geographic hole`                                                                         |
| les préférences influencent les propositions | `drops the options that exceed the walking limit of the profile`, `offers only wheelchair-friendly options…`, `orders by footprint…` |
| le nombre d'itinéraires est plafonné         | `caps the number of itineraries and keeps one option per family`                                                                     |

### Vérification de bout en bout

L'API doit tourner avec ses trois sources (voir `docs/otp-gtfs.md`,
`docs/gbfs-velov.md`, `docs/cycle-paths-postgis.md`) :

```bash
curl -X POST http://localhost:3001/api/routes/plan \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "from": { "label": "Part-Dieu", "lat": 45.760515, "lng": 4.859057 },
    "to":   { "label": "Bellecour", "lat": 45.757813, "lng": 4.832011 },
    "userId": "00000000-0000-4000-8000-000000000001"
  }'
```

Le plus simple reste **Swagger UI** (`http://localhost:3001/api/docs`), qui
authentifie et remplit le corps pour vous — voir la section « Comment tester »
du compte rendu du ticket.

> ⚠️ Le GTFS TCL utilisé est un instantané daté (voir `docs/otp-gtfs.md`) : OTP
> recale la date de service et le signale via `dateAdjusted`. Une réponse sans
> aucun trajet TC un jour donné vient presque toujours de là, pas de la fusion —
> `POST /api/routes/sources` permet de le vérifier en une requête.

## 12. Contraintes couvertes

**F2** (planificateur multimodal), **F3** (exploitation conjointe GTFS / GBFS /
PostGIS), **C5** (tout en mémoire, aucun appel supplémentaire, élargissement du
rayon sans coût réseau), **C9** (GeoJSON `LineString` standard, contrats
partagés), **C10** (dégradation gracieuse famille par famille), **C12**
(accessibilité PMR en filtre dur, jamais en simple préférence).
