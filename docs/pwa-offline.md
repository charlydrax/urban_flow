# Mode hors-ligne de la PWA — stratégies de cache (UF-601)

Référence de la couche hors-ligne d'UrbanFlow : **quelle ressource est mise en cache,
avec quelle stratégie, et pourquoi celle-là**. Sert de support à la partie
« contraintes techniques » du dossier T6.

Contraintes couvertes : **C1** (PWA installable et utilisable hors-ligne),
**C10** (connectivité variable), **C5** (éco-conception : requêtes évitées, cache borné),
**C7** (l'état hors-ligne est annoncé, pas subi), **C11** (aucun détail technique à l'écran).

Code : [`apps/web/sw.ts`](../apps/web/sw.ts) (worker),
[`apps/web/lib/offline.ts`](../apps/web/lib/offline.ts) (contrat + textes),
[`apps/web/components/offline/`](../apps/web/components/offline/) (indicateur).

---

## 1. Le besoin, tel qu'il vient du produit

Le scénario nominal du projet est un déplacement urbain : métro, tunnels, sous-sols,
réseau qui tombe **après** que l'itinéraire a été calculé. Le diagramme de séquence
le prévoit explicitement (étape 22 et cas d'erreur « réseau coupé après calcul »).

Une application de mobilité qui affiche une page blanche dès que le réseau tombe
est inutilisable exactement au moment où elle sert. La couche hors-ligne répond à
trois questions, dans cet ordre :

1. **L'application s'ouvre-t-elle ?** → cache du shell et des assets de build.
2. **Reste-t-il quelque chose d'utile à l'écran ?** → cache du dernier itinéraire
   et du fond de carte déjà consulté.
3. **L'usager sait-il ce qu'il regarde ?** → indicateur « mode hors-ligne » et
   mention explicite quand les résultats sont rejoués.

Le troisième point n'est pas cosmétique : servir un itinéraire d'hier sans le dire
est pire que ne rien servir du tout.

---

## 2. Tableau des stratégies

| Ressource                                                    | Stratégie                                                | Cache                     | Pourquoi celle-là                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigations (`/`, `/impact`, `/profil`…)                     | **network-first**, repli sur le shell `/`                | `urbanflow-shell-v3`      | Le contenu est authentifié et daté : le réseau doit gagner quand il est là. Le repli évite l'écran blanc.                                       |
| `POST /api/routes/plan`                                      | **network-first**, repli sur la dernière réponse réussie | `urbanflow-last-route-v1` | Un itinéraire est périssable : on ne sert le cache qu'en dernier recours, et on le **signale**.                                                 |
| `/_next/static/**`                                           | **cache-first**                                          | `urbanflow-assets-v2`     | Chunks hashés par le build : l'URL change à chaque version, la réponse est immuable. Aucune requête n'est justifiée.                            |
| `/manifest.json`, `/favicon.ico`, `/icons/*`, `/brand/*`     | **cache-first** (précachés)                              | `urbanflow-shell-v3`      | Nécessaires à l'app installée ; petits, stables, et attendus par l'OS au lancement. Le logo est rendu par la coque, donc par toutes les pages.  |
| Fond de carte tiers (tuiles, `style.json`, glyphes, sprites) | **cache-first borné** (250 entrées)                      | `urbanflow-map-tiles-v1`  | Une tuile déjà vue ne change pas d'un trajet à l'autre. Borné pour ne pas faire évincer les autres caches.                                      |
| Tout le reste (`/api/**` en GET, POST, PATCH…)               | **réseau seul**, pas de cache                            | —                         | Profil, historique, sélection d'itinéraire : données personnelles et mutables. Les mettre en cache serait un risque RGPD (C8) pour un gain nul. |

### Ce qui n'est délibérément **pas** mis en cache

- **Les routes de données personnelles** — profil (`/api/users/me`), historique de
  recherches, bilan carbone.
  Un cache de service worker survit à la déconnexion et n'est rattaché à aucune
  session : y déposer l'historique de déplacements d'un compte, c'est le laisser
  lisible au compte suivant sur le même appareil (C8/C11).
- **Les réponses en erreur** — un `500` mis en cache se rejouerait indéfiniment.
- **Les navigations redirigées** — un service worker n'a pas le droit de répondre
  à une navigation avec une réponse `redirected`, et le shell deviendrait l'écran
  de connexion (voir `isCacheableShell` dans `sw.ts`).

---

## 3. Le chemin du dernier itinéraire

```
  EN LIGNE                              HORS-LIGNE
  ────────                              ──────────
  POST /routes/plan                     POST /routes/plan
        │                                     │
   [service worker]                      [service worker]
        │  fetch → 200                        │  fetch → échec
        ├─────────────────────┐               │
        │                 cache.put           └─► cache.match(dernier)
        │            (clé /__offline/                    │
        │             last-route)                   trouvé ?
        ▼                                        ┌──────┴──────┐
   réponse fraîche                             oui            non
                                                 │              │
                                        200 + en-tête       503 fabriqué
                                   X-UrbanFlow-Cache:       par le worker
                                        last-route               │
                                                 │              │
                                                 ▼              ▼
                                      bandeau « affichage    message
                                       hors-ligne… »        « hors connexion »
```

**Pourquoi une clé synthétique.** L'API Cache refuse de stocker une requête `POST`.
Le worker écrit donc la réponse sous une clé fabriquée, `/__offline/last-route` —
un seul emplacement, pour un seul itinéraire : « le dernier », conformément au ticket.
Mémoriser N itinéraires demanderait de dériver une clé du corps de la requête, ce qui
reviendrait à mettre en cache des couples d'adresses (C8) pour un usage marginal.

**Pourquoi un en-tête.** Une réponse rejouée est un `200` en tout point identique à la
vraie. Sans marqueur, l'écran présenterait un trajet périmé comme le résultat de la
recherche qu'on vient de lancer. `X-UrbanFlow-Cache: last-route` est le seul canal du
worker vers la page ; il est lu par `lib/offline.ts` et figé par un test des deux côtés.

**Conséquence sur l'historique.** Une réponse rejouée porte le `searchHistoryId` de la
recherche _précédente_. `use-route-plan.ts` l'écarte : retenir un itinéraire dans ce cas
inscrirait le choix sur un trajet que l'usager n'a pas demandé et fausserait son bilan
carbone. La recherche courante, elle, n'a jamais atteint l'API — elle n'existe pas en base.

---

## 4. L'indicateur visuel

Trois messages, deux portées :

| Message                                                                                            | Où                                           | Déclencheur                                | Ton                    |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------ | ---------------------- |
| « **Mode hors-ligne** — Vous n'êtes plus connecté… »                                               | Bandeau global, sous l'en-tête, toutes pages | `navigator.onLine === false`               | `status`, fond Gold 50 |
| « Affichage hors-ligne : voici le dernier itinéraire calculé lors de votre recherche précédente… » | Panneau du planificateur                     | En-tête `X-UrbanFlow-Cache` sur la réponse | `status`, fond Gold 50 |
| « Vous êtes hors connexion et aucun itinéraire récent n'est enregistré… »                          | Panneau du planificateur                     | Échec réseau **et** appareil hors-ligne    | `status`, fond Gold 50 |

**`role="status"` et jamais `alert`.** Perdre le réseau n'est pas une urgence et
l'application reste utilisable : couper la parole à un lecteur d'écran pour annoncer
un état qu'aucune action ne corrigera serait gratuit (C7 — WCAG 4.1.3).

**La région live est montée en permanence**, vide quand tout va bien. Une région
insérée au moment de la coupure n'est pas annoncée — les lecteurs d'écran ne
surveillent que les régions déjà présentes dans l'arbre. Montée d'avance, elle annonce
la perte **et** le retour de la connexion.

**Contraste.** `text-warning` (#8a5300) sur `bg-tint-gold` (#fbf3e0) = 5.73:1, au-dessus
du seuil AA du texte courant. Vérifié par `lib/design-tokens.test.ts`.

**Ce que `navigator.onLine` vaut.** Il répond à « une interface réseau est-elle
active ? », pas à « Internet répond-il ? » : un Wi-Fi de gare capté sans accès réel se
déclare en ligne. L'indicateur est donc un **complément**, pas le filet principal — la
vérité sur l'accessibilité de l'API reste l'échec de la requête, et la provenance réelle
des résultats reste l'en-tête du worker.

---

## 5. Versionnement des caches

Les quatre caches portent un numéro de version dans leur nom. À l'activation, le worker
supprime **tout cache `urbanflow-*` absent de la liste attendue** : incrémenter une
version suffit à purger l'ancien contenu au prochain chargement.

| Cache                  | Version | Incrémenter quand…                        |
| ---------------------- | ------- | ----------------------------------------- |
| `urbanflow-shell`      | v2      | la liste des ressources précachées change |
| `urbanflow-assets`     | v2      | la stratégie sur `/_next/static/` change  |
| `urbanflow-last-route` | v1      | le contrat de `POST /routes/plan` change  |
| `urbanflow-map-tiles`  | v1      | le fournisseur de fond de carte change    |

Le worker n'est **pas actif en développement** : `ServiceWorkerRegister` le désinstalle
et purge ses caches sous `next dev`, où les chunks Next ne sont pas hashés — le
cache-first y servirait un bundle périmé indéfiniment. Toute vérification du hors-ligne
se fait donc sur un build de production (voir la recette).

---

## 6. Recette

Sur un **build de production** (`npm run build && npm start` dans `apps/web`),
Chrome DevTools ouvert :

1. **Le dernier itinéraire survit à la coupure.** Lancer une recherche
   (« Part-Dieu → Bellecour »). Onglet _Network_ → cocher **Offline**. Relancer la même
   recherche : les itinéraires réapparaissent, précédés du bandeau
   « Affichage hors-ligne… ».
2. **L'app shell se charge hors-ligne, sans écran blanc.** Toujours en _Offline_,
   recharger la page (F5) : l'interface se dessine, en-tête et navigation compris.
3. **L'indicateur s'affiche.** Dès le passage en _Offline_, le bandeau « Mode hors-ligne »
   apparaît sous l'en-tête ; il disparaît au décochage, sans rechargement.
4. **La carte garde ce qu'elle a vu.** En _Offline_, se déplacer sur une zone déjà
   parcourue : les tuiles se redessinent. _Application → Cache Storage →
   `urbanflow-map-tiles-v1`_ montre les entrées, plafonnées à 250.
5. **Lighthouse.** _Lighthouse → Progressive Web App_ : service worker détecté,
   manifest installable, réponse hors-ligne servie.

Cas limite à vérifier une fois : **hors-ligne sans aucun itinéraire en cache**
(vider `urbanflow-last-route-v1`, puis chercher) → message « Vous êtes hors connexion
et aucun itinéraire récent… », en jaune, jamais en rouge.

---

## 7. Limites connues

- **Une seule recherche mémorisée.** C'est le périmètre du ticket (« le dernier
  itinéraire »). Un historique hors-ligne complet supposerait un stockage indexé et
  une politique d'effacement RGPD dédiée — c'est de la roadmap, pas du MVP.
- **Le repli de navigation sert toujours le shell `/`.** Recharger `/impact` hors-ligne
  affiche l'accueil, pas la page demandée : pas d'écran blanc, mais pas la bonne page
  non plus. Une page `/offline` dédiée serait plus honnête.
- **Un fond de carte auto-hébergé** (`NEXT_PUBLIC_MAP_STYLE_URL`) n'est reconnu que par
  la forme `…/{z}/{x}/{y}` de ses URLs de tuiles ; ses glyphes et sprites, servis sur
  d'autres chemins, ne sont pas mis en cache. Le worker est bundlé par esbuild et n'a
  pas accès aux variables d'environnement inlinées par Next.
- **Aucune synchronisation différée.** Une recherche lancée hors-ligne n'est pas rejouée
  au retour du réseau (`Background Sync` non implémenté) : l'usager relance lui-même.
