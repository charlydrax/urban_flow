# Responsive & normes — passe finale (UF-606 · C2, C3, C9)

> Passe transverse d'ergonomie sur tous supports, de respect des standards des
> langages, et de conformité aux maquettes de référence. L'argument
> d'interopérabilité (C9) a son document dédié :
> [`interoperabilite.md`](./interoperabilite.md).

---

## 1. Ce que la passe a trouvé

Quatre régressions, toutes reproductibles, toutes corrigées. Elles sont listées
ici parce qu'elles disent quelque chose d'utile : **aucune n'était visible sur
le poste de développement**, en fenêtre large. Trois se déclenchaient sous
1024 px, la quatrième seulement sur une page courte.

### 1.1 Le planificateur débordait horizontalement sur mobile

**Symptôme.** Sur un écran de 375 px, toute la page défilait latéralement —
en-tête et pied de page compris, qui s'arrêtaient aux trois quarts de l'écran.

**Mesure.** 505 px de contenu pour 375 px de fenêtre. La piste unique de la
grille du planificateur était calculée à **489 px**.

**Cause.** Un élément de grille a un `min-width: auto` implicite : sa piste ne
descend jamais sous la **taille min-content** de son contenu. La colonne du
formulaire contient les trajets récents, dont les libellés sont en `truncate`
(`white-space: nowrap`) : leur min-content est la largeur du texte **entier**. Une
adresse un peu longue — « Rue de la Part-Dieu 69003 Lyon → Place Bellecour
69002 Lyon » — élargissait donc la piste, et avec elle la page.

Conséquence en cascade : tant que la piste s'élargissait, `truncate` ne se
déclenchait jamais. L'ellipse était là, elle ne servait à rien.

**Correction.** `min-w-0` sur les deux colonnes de la grille
(`features/planner/planner-screen.tsx`), et `minmax(0,1fr)` plutôt que `1fr` sur
la piste de la carte. Le plancher rendu à zéro, `truncate` reprend son rôle.

Le même plancher est posé **dans** `LazyMap` plutôt que chez chacun de ses
appelants : MapLibre dimensionne son `<canvas>` en pixels, ce qui donne à cette
enveloppe une largeur intrinsèque. Le composant qui porte le canvas est celui
qui doit porter le correctif.

### 1.2 L'en-tête se pliait en deux à 768 px

**Symptôme.** À la largeur exacte d'une tablette en portrait, chacun des six
éléments de la barre se cassait sur deux lignes : « Mon impact / CO₂ », « Mon /
profil », « marie@urbanflow. / dev ». L'en-tête devenait un pavé haché.

**Cause.** Le passage du menu replié au menu en ligne se faisait à `md`
(768 px) — c'est-à-dire exactement là où le contenu ne tient plus.

**Correction.** Bascule à `lg` (1024 px) : le menu replié, lisible et
manipulable au doigt, couvre désormais mobile **et** tablette. Les libellés sont
en `whitespace-nowrap` et l'adresse e-mail est tronquée avec un `title`, pour
qu'un compte à l'adresse longue ne puisse pas reproduire le pliage à 1024 px.

Le point de rupture suit ce que le contenu exige, pas une taille d'écran
symbolique.

### 1.3 La carte de compte comprimait l'e-mail sur mobile

**Symptôme.** Sur 375 px, `marie@urbanflow.dev` s'affichait sur trois lignes,
coupé au milieu des mots : « marie@u / rbanflo / w.dev ».

**Cause.** Le bloc d'identité était en `flex-1`, donc de base **zéro** : la
ligne « tenait » toujours, `flex-wrap` ne se déclenchait jamais, et le bloc se
faisait écraser à ~120 px entre la pastille d'initiales et le bouton. Le
`break-all` faisait le reste.

**Correction.** `basis-48` (12 rem) : la somme des éléments dépasse la ligne sous
~470 px, le bouton passe dessous à sa taille normale. Et `break-words` plutôt que
`break-all` — on ne coupe un mot que s'il ne rentre vraiment pas.

### 1.4 Le pied de page ne tenait pas le bas de la fenêtre

**Symptôme.** Sur une page courte — bilan carbone vide, écran de chargement — le
pied de page remontait au milieu de la fenêtre, suivi d'une bande de fond vide.

**Cause.** `<main>` portait `flex-1`, mais `<body>` n'était pas un conteneur
flexible : la classe ne faisait rien.

**Correction.** `<body>` devient `flex min-h-dvh flex-col`.

---

## 2. Écart avec les maquettes, corrigé

Les maquettes « 03 · MAQUETTES DESKTOP » sont dessinées à **1440 px** et posent
le planificateur en vue scindée, carte large à droite. Le conteneur général était
bridé à `max-w-5xl` (1024 px) : sur un écran de 1440, la carte tombait à ~470 px,
plus étroite que sur la maquette — alors que c'est l'écran de démonstration.

Le plafond passe à `max-w-7xl` (1280 px) pour les **pages larges** —
planificateur et tableau de bord carbone, les deux que les maquettes dessinent
en pleine largeur. La carte y gagne ~400 px.

Les pages de **lecture et de formulaire** reposent leur propre plafond à
`max-w-3xl` (768 px) : politique de confidentialité et profil. Ce n'est pas une
exception, c'est la règle inverse — une ligne de texte de 1280 px ne se lit pas
(WCAG 1.4.8 recommande ~80 caractères), et les descriptions sous les cases du
profil s'étalaient déjà sur près de 1000 px avant cette passe.

### Écarts restants, assumés

Ils l'étaient déjà avant ce ticket ; la passe les confirme plutôt qu'elle ne les
découvre.

| Élément de la maquette                    | État    | Pourquoi                                                                                                                                           |
| ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barre d'onglets basse (mobile)            | Absente | Le menu replié couvre les mêmes trois destinations ; une barre basse à cinq entrées supposerait des écrans « Défis » et « Trajets » hors périmètre |
| Navigation latérale persistante (desktop) | Absente | Même raison : la barre latérale de la maquette liste sept entrées, dont quatre n'existent pas                                                      |
| Écrans « Défis », « Récompenses »         | Absents | Gamification **hors périmètre** du prototype (CLAUDE.md §3)                                                                                        |
| « ★ Recommandé IA », prix « 1,90 € »      | Absents | Aucun modèle ne classe les options, aucune source ne publie de tarif — les inventer serait mentir à l'écran                                        |
| Répartition par mode (page impact)        | Absente | Supposerait de stocker le détail par segment de chaque trajet retenu (UF-505)                                                                      |

---

## 3. La recette est rejouable

Le point faible d'une passe de « polish » est qu'elle se coche une fois et se
périme au ticket suivant. Les régressions ci-dessus le montrent : aucune n'aurait
pu être vue par Vitest ou jsdom, qui n'ont pas de moteur de mise en page.

```bash
npm run dev                  # dans un autre terminal : web + API
npm run audit:responsive     # 6 écrans × 4 points de rupture
```

`apps/web/scripts/responsive-audit.mjs` pilote un Chrome sans interface par le
protocole DevTools, charge chaque écran clé à chaque point de rupture, et
**échoue** si un écart apparaît. Même logique que l'audit d'accessibilité
d'UF-602 et que le budget de poids d'UF-605 : une contrainte vérifiable plutôt
qu'une intention.

### Points de rupture audités

| Largeur | Pourquoi celle-là                                           |
| ------- | ----------------------------------------------------------- |
| 375 px  | Format dessiné — « 02 · MAQUETTES MOBILE » (375 × 812)      |
| 768 px  | Bascule Tailwind `md` — là où la mise en page change d'avis |
| 1024 px | Bascule `lg` — nouveau seuil de l'en-tête                   |
| 1440 px | Format dessiné — « 03 · MAQUETTES DESKTOP »                 |

Auditer seulement 375 et 1440 aurait laissé passer exactement le pliage
d'en-tête trouvé à 768.

### Contrôles exécutés sur chaque combinaison

| Contrôle                   | Ce qu'il attrape                           | C   |
| -------------------------- | ------------------------------------------ | --- |
| Débordement horizontal     | grille sans plancher, élément trop large   | C2  |
| Taille des cibles tactiles | bouton ou case trop petit au doigt         | C7  |
| Identifiants dupliqués     | HTML invalide, `for`/`aria` qui se perdent | C3  |
| Références ARIA pendantes  | libellé annoncé dans le vide               | C3  |
| Champ sans nom accessible  | saisie muette au lecteur d'écran           | C7  |
| Hiérarchie de titres       | `h2` sauté, plusieurs `h1`                 | C3  |
| Imbrications interdites    | `<div>` dans `<p>`, bouton dans bouton     | C3  |
| Repères de page            | `main` unique, `lang`, `<title>`           | C3  |
| Tableaux et `fieldset`     | `caption`, `scope`, `legend`               | C3  |

La cible tactile est mesurée sur le plus petit ancêtre **cliquable** : une case
à cocher de 16 px enveloppée dans un `<label>` rembourré est une cible de la
taille du label — ce que le doigt touche réellement.

Le seuil est **24 px**, celui du critère AA (WCAG 2.2, 2.5.8), et non les 44 px
que vise la charte (2.5.5, AAA). Un garde-fou qui échoue sur un objectif
ambitieux finit désactivé ; celui-ci arrête ce qui est hors norme, et la charte
reste l'objectif de qualité.

### Ce que l'audit ne remplace pas

Ces contrôles sont **structurels**. Un écran peut être valide, sans débordement,
et laid. Restent nécessaires :

- `npm run test:a11y` — axe-core sur le rendu, composant par composant (UF-602) ;
- la comparaison aux maquettes, qui demande un œil ;
- l'essai au doigt sur un vrai téléphone.

---

## 4. Résultat

```
Écran             Point de rupture  Verdict
──────────────────────────────────────────────────────────
planificateur     mobile 375        OK
planificateur     tablette 768      OK
planificateur     paysage 1024      OK
planificateur     desktop 1440      OK
impact            …                 OK
profil            …                 OK
connexion         …                 OK
inscription       …                 OK
confidentialité   …                 OK

6 écran(s) × 4 points de rupture : aucun écart.
```

Aucun débordement horizontal, aucune cible sous le seuil AA, aucun écart de
validité HTML sur les six écrans clés.
