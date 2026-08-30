# `components/layout` — coque et navigation principale

Navigation de la PWA, telle que dessinée sur la planche Figma : **barre d'onglets
basse sur mobile**, **rail latéral sombre sur desktop** (UF-803, ticket #92).

## Fichiers

| Fichier                | Rôle                                                                            |
| ---------------------- | ------------------------------------------------------------------------------- |
| `nav-items.ts`         | Modèle pur : catalogue des entrées, filtrage par état de session, entrée active |
| `nav-icons.tsx`        | Pictogrammes SVG inline, décoratifs (`aria-hidden`)                             |
| `app-nav.tsx`          | `AppNav` — les deux formes de la navigation, et le bloc de compte du rail       |
| `mobile-brand-bar.tsx` | Bandeau de marque du haut, mobile uniquement — **Server Component** (C5)        |
| `nav-items.test.ts`    | Recette du modèle — suite `unit`, environnement node                            |
| `layout.a11y.test.tsx` | Audit axe-core de la coque — suite `a11y`, jsdom                                |

`lib/initials.ts` complète l'ensemble : le helper d'initiales du bloc de compte,
sorti de `features/profile/` pour ne pas tirer les énumérations de
`@urbanflow/shared` dans le lot commun de toutes les pages (voir
`docs/eco-conception.md` §4.3).

`app/layout.tsx` assemble le tout : `<body>` passe en rangée flex à `lg`, `AppNav`
occupe la première piste (230 px), le reste vit dans une colonne `min-w-0`.

## Le point de conception : un composant, deux formes

`AppNav` rend **un seul** conteneur qui se métamorphose par variantes `lg:` —
barre fixe en bas sous 1024 px, rail sticky de 230 px au-delà. Ce n'est pas une
économie de fichiers, c'est la seule façon d'obtenir les deux propriétés que la
recette du ticket demande :

- **un unique repère `navigation`**. Deux composants montés simultanément (l'un
  masqué par média-requête) auraient donné deux `<nav>` homonymes dans le DOM —
  axe le signale (`landmark-unique`), et un lecteur d'écran annonce deux fois
  « navigation principale » sans les distinguer ;
- **une navigation cohérente entre invité et connecté, d'un support à l'autre**.
  Avec une seule liste consommée une seule fois, la cohérence n'est plus une
  consigne de relecture : elle est structurelle.

## Qui voit quoi

`NavItem.audience` — `all`, `member` ou `guest` :

| Entrée      | Route     | Public   |
| ----------- | --------- | -------- |
| Itinéraires | `/`       | `all`    |
| Mon impact  | `/impact` | `member` |
| Mon profil  | `/profil` | `member` |
| Connexion   | `/login`  | `guest`  |

Le bloc de compte au pied du rail (identité + déconnexion, ou invitation à créer
un compte) complète l'ensemble sur desktop ; sur mobile, ces deux actions vivent
dans `/profil`, à un onglet de distance.

> ⚠️ **`audience` n'est pas une protection.** Il décide de l'affichage, rien de
> plus. L'autorité reste le middleware (`middleware.ts`, UF-106) et, derrière
> lui, le guard JWT de l'API (UF-104, C4). Retirer une entrée d'ici n'a jamais
> fermé une page.

## Écarts assumés par rapport à la planche

| Planche                                            | Ici                         | Pourquoi                                                                                                                                                   |
| -------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8 entrées de rail (défis, signalements, stations…) | 3 écrans réellement livrés  | Ces écrans n'existent pas : la fonctionnalité au choix retenue est l'empreinte carbone (CLAUDE.md §3). Une entrée qui ne mène nulle part est un lien mort. |
| Pictogrammes emoji                                 | SVG inline monochromes      | Un emoji est du texte : NVDA annonce « globe montrant l'Europe » avant le libellé. Rendu et couleur dépendent aussi de la police système (C7, C5).         |
| Libellés courts sur les onglets (« Trajets »)      | Le libellé complet, partout | Deux textes pour un même lien violent WCAG 2.5.3 (« Label in Name »). Avec ≤ 4 onglets, le libellé entier tient sous le picto.                             |
| Entrée active : blanc sur Vert 500                 | Blanc sur Vert 700          | 3.08:1 contre les 4.5:1 exigés à 13,5 px. Vert 700 donne 5.42:1, et 3.38:1 entre la pastille et le rail (WCAG 1.4.11).                                     |

Les trois ratios sont figés par `lib/design-tokens.test.ts`, y compris celui qui
échoue : un retour à la valeur de la planche casse la CI.

## Contraintes couvertes

- **C2** — mobile-first : la navigation est au pouce sous 1024 px, en rail au-delà.
- **C7** — repère nommé unique, `aria-current="page"`, cibles ≥ 44 px, pictos
  décoratifs, contrastes AA vérifiés.
- **C5** — pictogrammes inline (ni requête, ni police), un seul arbre rendu au
  lieu de deux, bandeau de marque laissé côté serveur, modèle testé sans jsdom.
  Coût net mesuré : **+1,7 ko gzip** de socle commun (`docs/eco-conception.md` §4.3).
- **C4/C11** — l'affichage suit la session, il ne la remplace pas.
