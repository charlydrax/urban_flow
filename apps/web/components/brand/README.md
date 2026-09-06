# `components/brand` — logo et déclinaisons

Source unique de la marque UrbanFlow Mobility dans l'interface (BUG-004, issue #114).

## Fichiers

| Fichier                | Rôle                                                          |
| ---------------------- | ------------------------------------------------------------- |
| `brand-logo.tsx`       | `BrandLockup` (bloc complet) et `BrandMark` (emblème seul)    |
| `brand-assets.test.ts` | Recette : les fichiers existent, sont carrés là où il le faut |

Les images vivent dans `public/brand/` ; les icônes d'application, elles, sont
dans `public/icons/` et `public/favicon.ico` — elles ne sont jamais rendues par
un composant, c'est le navigateur et le système qui vont les chercher.

## Les déclinaisons, et pourquoi il en faut deux

Le logo fourni est un **bloc combiné** : un emblème (ville, vélo, trottinette,
voiture, pris dans une vague) surmontant le mot-symbole « UrbanFlow MOBILITY ».
Le rapport largeur/hauteur du bloc est de 1,3 : 1. À la hauteur d'une barre de
navigation mobile — 28 px — il ferait 36 px de large, et le mot-symbole ne serait
plus qu'une tache grise.

D'où deux déclinaisons découpées dans le fichier d'origine :

| Déclinaison   | Fichier                          | Dimensions | Employée par                           |
| ------------- | -------------------------------- | ---------- | -------------------------------------- |
| `BrandLockup` | `/brand/logo-urbanflow.png`      | 480 × 368  | rail desktop (150 px), écrans d'auth   |
| `BrandMark`   | `/brand/logo-urbanflow-mark.png` | 179 × 96   | barre de marque mobile (28 px de haut) |

La règle : **en dessous de ~140 px de large, c'est `BrandMark`.**

## Le fond blanc du fichier source

Le PNG livré n'est pas détouré : son fond est blanc **opaque**, et le mot
« Urban » y est écrit en blanc filet de gris — un relief qui ne fonctionne que
sur clair. Deux conséquences, assumées :

- sur les surfaces claires (barre mobile, cartes d'authentification), l'image se
  fond d'elle-même, rien à faire ;
- sur le rail sombre, elle est posée sur une **plaque blanche arrondie**
  (`rounded-lg bg-white p-2`). Sans elle, on verrait un rectangle blanc mal
  détouré au lieu d'un logo.

Détourer le fond automatiquement n'était pas une option : le seuil qui ferait
disparaître le fond ferait disparaître le mot « Urban » avec lui.

## Accessibilité (C7)

`alt` est **obligatoire** sur les deux composants, mais la valeur juste est
souvent la chaîne vide :

| Contexte                                           | `alt`                            | Pourquoi                                                   |
| -------------------------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| Rail desktop (le logo est le lien)                 | `"UrbanFlow Mobility — accueil"` | L'image porte seule le nom accessible du lien (WCAG 1.1.1) |
| Barre mobile (logo + texte « UrbanFlow Mobility ») | `""`                             | Sinon le lecteur d'écran annonce la marque deux fois       |
| Écrans d'authentification                          | `""`                             | Le `<h1>` et le titre de l'onglet disent déjà le service   |

Le contraste du mot-symbole n'est pas un défaut AA : WCAG 1.4.3 exempte
explicitement les logotypes du critère de contraste.

## Pourquoi `<img>` et non `next/image` (C5)

`next/image` apporte un composant client et son runtime. Ces images-ci sont
statiques, de dimensions fixes, déjà redimensionnées et compressées à la taille
d'affichage (PNG palettisés, 52 ko à elles deux). L'optimiseur n'aurait rien à
optimiser, mais son runtime entrerait dans le lot JavaScript du **layout
racine**, donc de toutes les pages. Les attributs `width`/`height` explicites
rendent le seul service qui comptait — réserver la place, éviter le décalage de
mise en page — pour zéro octet de JavaScript.

## Regénérer les images

Les sept fichiers dérivent tous du même PNG d'origine (625 × 440), par
découpe puis rééchantillonnage Lanczos et compression en PNG palettisé. La
procédure et les coordonnées de découpe sont consignées dans
[`docs/brand-assets.md`](../../../../docs/brand-assets.md).
