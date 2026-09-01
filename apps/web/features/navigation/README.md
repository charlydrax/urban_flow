# `features/navigation` — guidage temps réel (UF-806)

Suivi d'un itinéraire retenu, de « Démarrer » à « Vous êtes arrivé ». C'est le
maillon qui manquait entre le planificateur (F2) et l'usager en déplacement :
jusqu'ici, la sélection d'une option s'arrêtait à la mise en avant du tracé.

## Rôle

| Fichier                 | Rôle                                                      |
| ----------------------- | --------------------------------------------------------- |
| `start-navigation.tsx`  | Bouton « Démarrer » sous la liste de résultats            |
| `use-navigation.ts`     | Ouvre/ferme l'abonnement GPS et le branche sur la machine |
| `navigation-screen.tsx` | Carte plein cadre + caméra qui suit la position           |
| `navigation-sheet.tsx`  | Panneau de guidage d'après la maquette « 6. NAVIGATION »  |

La logique, elle, ne vit pas ici mais dans deux modules **purs** de `lib/`,
testables sans navigateur :

| Module                      | Ce qu'il décide                                              |
| --------------------------- | ------------------------------------------------------------ |
| `lib/route-progress.ts`     | où l'on est sur le tracé, ce qu'il reste, si l'on est arrivé |
| `lib/navigation-machine.ts` | la phase du guidage et les libellés qui s'en déduisent       |

C'est la même frontière qu'entre `lib/route-map-layers.ts` et
`components/map/use-route-overlay.ts` : ce qui se calcule sans DOM se calcule
sans DOM, et la recette du ticket se vérifie donc sans GPS.

## Dépendances

- `lib/geolocation.ts` — `watchUserPosition` (UF-806), à côté du
  `getCurrentPosition` d'UF-202 : **réglages inverses, aucun état partagé**, les
  deux modes coexistent.
- `features/planner/use-user-location.ts` — le portail de consentement d'UF-202
  et UF-802, réutilisé tel quel. Le guidage ne recueille aucun accord de son côté.
- `RouteSegment.geometry` — les `LineString` par segment, déjà au contrat depuis
  UF-403. **UF-806 n'a demandé aucun changement d'API** ; c'est UF-807 qui en a
  ajouté un, `POST /api/search-history/:id/completion`, pour consigner l'arrivée.
- `features/planner/use-route-plan.ts` — `reportArrival`, branché sur `onArrival`
  (UF-807) : il tient le `searchHistoryId` de la recherche en cours.

## L'arrivée, et ce qu'elle déclenche (UF-807)

`arrived` est un état **terminal** : seul `stop` en sort. C'est ce qui rend
l'événement d'arrivée sûr à brancher — l'effet ne se rejoue pas aux mesures
suivantes, et trois pas dans le hall n'ajoutent pas un second trajet au bilan
carbone. L'itinéraire remonté est celui sur lequel le guidage a **démarré**, pas
l'option cochée dans la liste : c'est ce qui a été parcouru qu'il faut valoriser.

Un guidage arrêté en chemin ne remonte rien. C'est la recette 1 du ticket, vue
du client : un itinéraire sélectionné mais non parcouru n'entre pas dans le suivi
carbone.

## La machine à états

```
             start                position (arrivé)
  idle ─────────────► guiding ──────────────────────► arrived
   ▲                  │   ▲                              │
   │            pause │   │ resume / position            │ stop
   │                  ▼   │                              │
   │                 paused                              │
   │                  │                                  │
   │                  │  signal-lost                     │
   │                  ▼                                  │
   │            signal-lost ──── position ──► guiding    │
   └──────────────────┴──────── stop ────────────────────┘
```

« Segment suivant » n'est **pas** un état : c'est un `segmentIndex` qui change à
l'intérieur de `guiding`. En faire un état obligerait à en sortir à chaque
tronçon, alors que rien du guidage ne change — seul le contenu de l'écran bouge.

**Une position reçue vaut retour du signal** : un tunnel se traverse sans que
l'usager touche à quoi que ce soit, et c'est pour cela que l'abonnement reste
ouvert pendant `signal-lost`.

## Contraintes couvertes

| Contrainte | Comment                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C6**     | `enableHighAccuracy: true` / `maximumAge: 0` ; les 4 causes d'échec normalisées d'UF-202 sont réutilisées ; l'écart au tracé est annoncé, jamais bloquant                                                                     |
| **C5**     | L'abonnement haute précision ne vit que dans `guiding` et `signal-lost` (`needsPositionWatch`) ; **une seule requête réseau** sur tout le parcours, à l'arrivée (UF-807)                                                      |
| **C7**     | Annonce `aria-live` complète à chaque changement d'état ; statut d'étape écrit en toutes lettres, jamais porté par la seule couleur ; `aria-pressed` sur le suivi de caméra ; `prefers-reduced-motion` respecté par la caméra |
| **C8**     | Aucun second point de collecte du consentement ; la position ne quitte pas l'appareil                                                                                                                                         |
| **C2**     | Carte plein cadre, panneau bas, cibles tactiles ≥ 44 px                                                                                                                                                                       |

## Écarts assumés à la maquette

| Élément planche         | Pourquoi il n'est pas là                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « +45 pts à l'arrivée » | Gamification hors périmètre du prototype (CLAUDE.md §3) — même écart qu'en UF-404                                                                                                                                                                                           |
| « ✓ correspondance OK » | Le sous-titre dit l'horaire réel du prochain passage quand la source l'horodate. Juger la correspondance « OK » demanderait de comparer à une heure d'arrivée que nous **estimons**, pas que nous connaissons : annoncer « OK » sur une estimation ferait rater un bus (C9) |
| Écran desktop dédié     | La planche n'en propose pas : les trois maquettes desktop sont le tableau de bord, le planificateur et l'empreinte carbone. Le guidage est spécifié mobile, et la carte s'élargit simplement au-delà du point de rupture                                                    |

Le bouton principal est **« Mettre en pause » en cours de guidage** et
« Reprendre le guidage » à l'arrêt. La planche montre l'écran suspendu, donc son
libellé de reprise ; peindre « Reprendre » pendant que la carte avance dirait le
contraire de ce que fait l'écran.

## Ce que le module ne fait pas

**Il ne recalcule aucun itinéraire.** Un usager qui s'écarte du tracé est
prévenu et invité à relancer une recherche — le client ne fabrique pas de
proposition que le Service Itinéraire n'a jamais validée.

**Il n'émet aucune requête pendant le guidage.** Une seule sort de tout le
parcours, et seulement à la fin : l'arrivée (UF-807). Le module ne l'émet même
pas lui-même — `useNavigation` appelle `onArrival`, et c'est le planificateur qui
consigne, parce que lui seul connaît la ligne d'historique de la recherche en
cours. Le guidage constate, le planificateur enregistre.
