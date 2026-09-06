# Fichiers de marque — logo, favicon, icônes PWA

Comment les sept images de marque sont produites à partir du logo d'origine, et
où chacune est employée (BUG-004, issue #114).

---

## 1. Inventaire

| Fichier                                 | Dimensions | Poids  | Employé par                                             |
| --------------------------------------- | ---------- | ------ | ------------------------------------------------------- |
| `public/favicon.ico`                    | 16/32/48   | 15 ko  | onglet du navigateur, favoris, `<link rel="shortcut">`  |
| `public/icons/icon-192.png`             | 192 × 192  | 11 ko  | manifeste, `purpose: any`                               |
| `public/icons/icon-512.png`             | 512 × 512  | 39 ko  | manifeste, `purpose: any`, écran de démarrage Android   |
| `public/icons/icon-maskable-192.png`    | 192 × 192  | 4,6 ko | manifeste, `purpose: maskable`                          |
| `public/icons/icon-maskable-512.png`    | 512 × 512  | 18 ko  | manifeste, `purpose: maskable`                          |
| `public/icons/apple-touch-icon-180.png` | 180 × 180  | 9,6 ko | iOS — écran d'accueil (le manifeste y est ignoré)       |
| `public/brand/logo-urbanflow.png`       | 480 × 368  | 42 ko  | `BrandLockup` — rail desktop, écrans d'authentification |
| `public/brand/logo-urbanflow-mark.png`  | 179 × 96   | 8,6 ko | `BrandMark` — barre de marque mobile                    |

Les deux derniers sont rendus par des composants React
(`components/brand/brand-logo.tsx`) ; les six premiers ne le sont jamais — ce
sont le navigateur et le système qui vont les chercher, à partir des
métadonnées de `app/layout.tsx` et de `public/manifest.json`.

---

## 2. Les deux découpes du fichier d'origine

Le logo livré (`logo_urbanflow.png`, 625 × 440) est un **bloc combiné** :
emblème au-dessus, mot-symbole « UrbanFlow MOBILITY » en dessous, sur fond blanc
opaque. Le contenu utile n'occupe pas tout le cadre ; les coordonnées ci-dessous
sont celles de la boîte englobante des pixels non blancs, mesurées une fois et
figées ici.

| Découpe | Zone source (`left, top, width, height`) | Ce qu'elle contient   |
| ------- | ---------------------------------------- | --------------------- |
| `FULL`  | `114, 49, 419, 321`                      | emblème + mot-symbole |
| `MARK`  | `114, 49, 419, 225`                      | emblème seul          |

La séparation à `y = 274` tombe dans une bande de treize lignes entièrement
blanches — c'est la gouttière que le graphiste a laissée entre l'emblème et le
mot-symbole, pas un seuil choisi à l'œil.

**Pourquoi deux découpes.** Le bloc complet a un rapport de 1,3 : 1. Réduit à la
hauteur d'une barre de navigation mobile (28 px), il ferait 36 px de large et le
mot-symbole y serait illisible. Sous ~140 px de large, c'est donc l'emblème seul
qui est employé — y compris pour la favicon, qui vit à 16 px.

---

## 3. Marges

| Cible              | Découpe | Marge | Pourquoi                                                                                                                                                                                               |
| ------------------ | ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `icon-*` (`any`)   | `FULL`  | 6 %   | L'icône est affichée telle quelle : juste de quoi ne pas coller aux bords.                                                                                                                             |
| `icon-maskable-*`  | `MARK`  | 22 %  | Android rogne l'icône selon une forme au choix du constructeur — cercle, goutte, carré arrondi. Seuls les **80 % centraux** sont garantis visibles. Le mot-symbole n'y survivrait pas ; l'emblème, si. |
| `apple-touch-icon` | `FULL`  | 6 %   | iOS arrondit lui-même les angles et n'accepte pas la transparence.                                                                                                                                     |
| `favicon.ico`      | `MARK`  | 2 %   | À 16 px, chaque pixel de marge est un pixel de logo en moins.                                                                                                                                          |

C'est la correction de fond apportée au manifeste par ce ticket : il déclarait
auparavant **le même fichier** en `any` et en `maskable`, ce qui faisait rogner
le logo sur l'écran d'accueil Android. `brand-assets.test.ts` interdit désormais
ce recouvrement.

---

## 4. Le cas de la favicon

Le fichier `.ico` fourni mesurait **256 × 180** — non carré. Un onglet de
navigateur affiche la favicon dans un carré de 16 px : une source rectangulaire
y est étirée, et le logo se retrouve écrasé.

Le `favicon.ico` du dépôt est donc reconstruit : trois entrées carrées
(16, 32, 48) contenant chacune un **DIB 32 bits** — en-tête
`BITMAPINFOHEADER`, bitmap XOR en BGRA de bas en haut, puis masque AND opaque.
Le PNG-dans-ICO, plus court à écrire, aurait suffi aux navigateurs mais pas à
l'Explorateur Windows ni à certains agrégateurs.

Trois tailles et pas une : 16 px pour l'onglet, 32 px pour la barre de favoris
et les raccourcis, 48 px pour l'épinglage au bureau. Laisser le navigateur
réduire une seule source donne un résultat visiblement plus flou à 16 px que le
rééchantillonnage fait ici.

---

## 5. Regénérer

Les images sont **versionnées**, pas construites par la CI : elles ne changent
qu'au rythme de la charte graphique, et une étape de build supplémentaire pour
sept fichiers stables serait payée à chaque `npm run build` (C5).

Les originaux livrés par le client sont conservés dans
[`docs/assets/`](assets/) — `logo-urbanflow-source.png` (625 × 440, celui dont
tout dérive) et `logo-urbanflow-source.ico` (256 × 180, écarté au §4 pour n'être
pas carré). Ils ne sont **pas** servis par l'application ; ils sont là pour que
la regénération ci-dessous reste possible sans redemander les fichiers.

Pour les refaire à partir d'un nouveau logo, le procédé est celui décrit
ci-dessus : découpe aux coordonnées du §2, rééchantillonnage **Lanczos 3**,
composition centrée sur un carré blanc avec la marge du §3, puis encodage en PNG
**palettisé** (`palette: true, quality: 90, effort: 10`). La palettisation divise
le poids par cinq environ sur ces aplats — 198 ko → 42 ko pour le bloc complet
(C5, C10).

`sharp` fait tout cela et est déjà présent dans `node_modules` (dépendance
transitive de Next.js). Il n'est volontairement **pas** ajouté aux dépendances du
projet : ce serait déclarer une dépendance de production pour un outil qui ne
sert qu'à une opération manuelle et rarissime.

Après regénération, penser à :

1. mettre à jour le tableau du §1 si des tailles changent ;
2. mettre à jour `width`/`height` dans `components/brand/brand-logo.tsx` —
   `brand-assets.test.ts` échoue sinon ;
3. **incrémenter `SHELL_CACHE` dans `apps/web/sw.ts`**. Les icônes sont servies
   cache-first sous un nom de fichier inchangé : sans nouveau nom de cache, un
   visiteur déjà venu garde l'ancienne marque indéfiniment.

---

## 6. Vider les caches pour voir le changement

Une favicon est l'une des ressources les plus agressivement mises en cache du
Web, et le service worker en rajoute une couche. Après déploiement :

| Où                   | Geste                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------- |
| Onglet du navigateur | rechargement forcé (`Ctrl` + `Maj` + `R`) ; au besoin, ouvrir `/favicon.ico` seul      |
| Service worker       | DevTools → Application → Service Workers → **Update** puis **Skip waiting**            |
| Cache du worker      | DevTools → Application → Storage → **Clear site data**                                 |
| PWA installée        | désinstaller puis réinstaller — l'icône d'accueil est copiée par l'OS à l'installation |

L'incrément de `SHELL_CACHE` rend les deux lignes du milieu inutiles pour un
visiteur ordinaire : le nouveau worker supprime l'ancien cache à son activation.
Elles restent nécessaires en développement, où le worker peut rester bloqué en
état « waiting ».
