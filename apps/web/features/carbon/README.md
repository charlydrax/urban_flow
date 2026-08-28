# `features/carbon` — Page « Mon impact » (UF-505)

## Rôle

Le **suivi carbone personnel**, second volet de la fonctionnalité au choix
retenue : après le CO₂ par itinéraire (UF-501/504), le cumul dans le temps.
Route `/impact`, maquette Figma « 8. EMPREINTE CARBONE » (mobile) et
« DESKTOP 3 : EMPREINTE CARBONE » (large).

## Composition

| Fichier                 | Rôle                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `carbon-dashboard.tsx`  | Écran complet : sélecteur de période, indicateurs, deux panneaux |
| `impact-comparison.tsx` | « Vos trajets vs tout en voiture » — deux barres, une échelle    |
| `impact-trend.tsx`      | « Évolution du CO₂ évité » — quatre barres + tableau équivalent  |
| `use-carbon-summary.ts` | Lecture de `GET /api/carbon/summary`, une fois par période       |

La mise en forme (parts, hauteurs de barres, libellés) vit dans
[`lib/carbon-summary.ts`](../../lib/carbon-summary.ts) — module **pur**, testé
sans React comme `carbon-badge.ts` et `itinerary-cards.ts`.

## Ce que la page compte

**Uniquement les itinéraires retenus.** Une recherche n'entre dans le bilan
qu'une fois que l'usager a **cliqué** sur une carte de résultat. La première
option est présélectionnée à l'arrivée des résultats, mais c'est un classement du
serveur, pas une décision : l'enregistrer ferait un bilan de trajets que personne
n'a faits.

C'est `useRoutePlan.select` (dans `features/planner`) qui appelle
`PATCH /api/search-history/:id/selection`, sans jamais envoyer de grammes — le
Service Carbone valorise côté serveur.

Les recherches restées sans choix sont **annoncées** en bas de page. Sans cette
phrase, quelqu'un qui cherche beaucoup et choisit peu verrait un total bas sans
comprendre pourquoi, et conclurait à une panne.

## Deux visualisations, pas plus

Le ticket demande de rester sobre. La comparaison au tout-voiture porte la
proposition de valeur (« qu'est-ce que mes choix ont évité ? ») et le graphique
porte la recette « au moins un indicateur d'évolution ou de comparaison ».

**Écarts assumés avec la maquette :**

- La **répartition par mode** (« Bus 44 %, Métro 28 %… ») est absente : elle
  suppose de stocker le détail par segment de chaque trajet retenu, donc une
  table de plus. C'est un ticket, pas une case à cocher.
- Les **« arbres équivalents »** sont absents : le facteur d'absorption ne figure
  pas dans le barème transport de l'ADEME et demanderait sa propre source. La
  quatrième tuile affiche le nombre de trajets retenus à la place.
- L'évolution est rendue en **barres** plutôt qu'en courbe. Une courbe suggère
  une grandeur continue échantillonnée ; il n'y a ici que quatre totaux de
  tranches, et la pente entre deux points ne décrirait aucun trajet réel.

## Un bilan vide n'est pas une erreur

Trois états distincts, et trois messages différents :

| Situation             | Ce que la page affiche                                |
| --------------------- | ----------------------------------------------------- |
| Lecture en cours      | « Chargement de votre bilan… », pas des zéros         |
| Aucun trajet retenu   | Zéros **et** la marche à suivre pour remplir le bilan |
| L'API n'a pas répondu | Un message d'erreur, jamais « 0 g CO₂ »               |

Afficher un bilan nul à la place d'une réponse manquante serait pire qu'un
message d'erreur : l'usager y lirait un résultat, et un faux.

## Contraintes couvertes

| Contrainte | Traduction dans la feature                                                               |
| ---------- | ---------------------------------------------------------------------------------------- |
| C2         | Indicateurs empilés sur mobile, en grille à partir de `sm`, panneaux côte à côte en `lg` |
| C5 / C10   | Une lecture par période, aucun rafraîchissement automatique, aucune librairie de graphes |
| C7         | Sélecteur en groupe radio, graphique doublé d'un tableau `sr-only`, couleur jamais seule |
| C8         | Les données affichées sont celles du seul compte connecté (l'API les résout du JWT)      |
| C9         | Contrats `CarbonSummary` / `CarbonPeriodTotals` consommés depuis `@urbanflow/shared`     |

## Tests

```bash
cd apps/web && npx vitest run lib/carbon-summary.test.ts
```

Les tests portent sur le module pur : aucun gramme n'est recalculé côté client,
un compte sans données ne se voit reprocher aucun chiffre, et une valeur non
nulle reste **visible** dans le graphique si petite soit-elle — un trajet
enregistré ne doit pas ressembler à un trou.
