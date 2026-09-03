# Traitement des bogues — UrbanFlow Mobility (UF-607)

Procédure de bout en bout : **détection → priorisation → correction → validation**.
Elle décrit ce qui est réellement outillé dans le dépôt, pas une intention.

> **Contexte.** Le projet est mené par une seule personne. La procédure est donc
> calibrée pour ça : pas de comité de tri hebdomadaire, pas de rôle « QA »
> séparé. Ce qui est écrit ici est ce qu'une personne seule peut tenir sur la
> durée — et ce qui, tenu, suffit à ne perdre aucun défaut.

---

## 1. Vue d'ensemble

```
        ┌── PWA : écran d'erreur + signalement automatique ──┐
        │                                                    ▼
Usager ─┤                                        POST /api/diagnostics/client-errors
        │                                                    │
        └── Test / recette manuelle en préproduction ──┐     │
                                                       ▼     ▼
API : journal structuré JSON  ───────────────►  requestId partagé
                                                       │
                                                       ▼
                                       Issue GitHub (formulaire 🐞 Bogue)
                                                       │
                          ┌────────────────────────────┴──────────────┐
                          ▼                                           ▼
                 Tri : gravité P0→P3                          Registre CLAUDE.md §10
                          │                                (rappel local, lu chaque session)
                          ▼
              Branche fix/bug-XXX-… → test de non-régression → PR → CI verte
                          │
                          ▼
              Validation en préproduction → merge → fermeture de l'issue
```

---

## 2. Détection — trois canaux, aucun angle mort

| Canal                 | Ce qu'il attrape                                        | Outil                                                        |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| **Journal serveur**   | Erreurs 5xx, sources externes muettes, entrées refusées | Journalisation structurée JSON (`common/logging/`)           |
| **Signalement front** | Plantages d'affichage, que le serveur ne voit jamais    | `app/error.tsx` → `POST /api/diagnostics/client-errors`      |
| **Tests automatisés** | Régressions sur les parcours critiques                  | `npm run test` en CI (dont `src/critical-paths.e2e.spec.ts`) |

### 2.1 Le fil rouge : `X-Request-Id`

Chaque requête reçoit un identifiant de corrélation, généré par l'API ou repris
du client s'il en fournit un valide (`common/logging/request-id.middleware.ts`).
Il apparaît à **trois** endroits, et c'est ce qui rend une enquête possible :

1. dans l'en-tête `X-Request-Id` de la réponse ;
2. dans le **corps** de toute réponse d'erreur (champ `requestId`) ;
3. dans **chaque ligne de journal** émise pendant le traitement.

L'écran d'erreur de la PWA l'affiche à l'usager sous l'intitulé « Référence à
indiquer en cas de signalement ». Recopié dans l'issue, il mène directement à la
trace :

```bash
make preprod-logs-api | grep '"requestId":"5f1d1c0a-2a6e-4f3b-9a8f-2c1d3e4f5a6b"'
```

> **Pourquoi ce détour plutôt qu'un service tiers (Sentry & co.).** La
> plateforme traite des données de déplacement. Les expédier chez un
> sous-traitant hors périmètre demanderait une base légale, une mention au
> registre et un transfert documenté (C8). Pour le volume d'un MVP, une ligne
> JSON dans nos propres journaux suffit — et ne sort pas de chez nous (C11).

### 2.2 Ce que les journaux ne contiennent jamais

Ni corps de requête, ni coordonnées, ni e-mail, ni jeton (C11 / RGPD). Un
journal dit **ce qui s'est passé techniquement** : méthode, chemin, statut,
durée, source en panne. Il ne dit pas **qui allait où** — et il n'en a pas
besoin pour servir au diagnostic. Les sauts de ligne des messages sont échappés
pour qu'une entrée ne puisse pas en forger une autre (OWASP A09).

---

## 3. Priorisation — le tri

Tout signalement ouvre une issue via le formulaire
[`🐞 Bogue`](../.github/ISSUE_TEMPLATE/bug_report.yml), qui pose d'emblée les
labels `bug` et `needs-triage`. Le tri consiste à remplacer `needs-triage` par
une priorité et un environnement.

| Priorité | Définition                                                     | Exemple                                              | Traitement                                     |
| -------- | -------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| **P0**   | Produit inutilisable, ou donnée personnelle exposée            | La connexion échoue pour tous ; une fuite de données | **Immédiat** — tout autre travail s'interrompt |
| **P1**   | Une fonctionnalité du périmètre (F1/F2/F3, carbone) est cassée | Le planificateur ne rend jamais d'itinéraire         | Avant toute nouvelle fonctionnalité            |
| **P2**   | Gêne réelle, contournement possible                            | Le tri par CO₂ s'inverse après un filtre             | Planifié dans un sprint                        |
| **P3**   | Défaut d'affichage ou de libellé, sans effet fonctionnel       | Une virgule décimale manquante                       | Quand la charge le permet                      |

Deux labels transverses complètent le tri :

- **`regression`** — « cela fonctionnait avant ». Monte d'un cran de priorité,
  **et** impose un test de non-régression dans le correctif : une régression
  non couverte reviendra.
- **`env: prod` / `env: preprod` / `env: dev`** — l'échelle du poids d'un
  défaut. Un défaut vu en développement n'a encore blessé personne ; vu en
  préproduction, il est proche de ce qui sera livré ; vu en **production**, il
  est subi par de vrais visiteurs et prime sur tout le reste. `env: prod` a été
  ajouté par BUG-002 (#106) : la taxonomie s'arrêtait à la préproduction, parce
  qu'au moment d'UF-607 la production n'existait pas encore.

La taxonomie complète, avec ses couleurs et ses justifications, est versionnée
dans [`.github/labels.yml`](../.github/labels.yml).

### 3.1 Le registre local (CLAUDE.md §10)

Un défaut **diagnostiqué mais volontairement non corrigé** est doublé d'une
entrée dans la section 10 de `CLAUDE.md`. L'issue reste la référence — détail,
options écartées, recette ; le registre en est le rappel, parce qu'il est relu à
chaque session de travail alors que la liste d'issues, non. L'entrée est retirée
quand l'issue se ferme.

---

## 4. Correction

1. **Reproduire d'abord**, en préproduction quand le défaut y a été vu
   (`make preprod-up`). Un correctif écrit sans reproduction ne corrige qu'une
   hypothèse.
2. **Brancher** : `fix/bug-XXX-description-courte` depuis `main` à jour
   (nomenclature de [`docs/git-workflow.md`](git-workflow.md)).
3. **Écrire le test qui échoue** avant le correctif. C'est la seule preuve que
   le défaut est compris, et le seul moyen qu'il ne revienne pas. Le test va
   au plus près : unitaire si la cause est locale,
   `src/critical-paths.e2e.spec.ts` si le défaut se loge **entre** deux couches.
4. **Corriger**, avec un commit `fix(scope): …` qui référence l'issue.
5. **Ouvrir la PR** vers `main`. La CI doit être verte : format, lint,
   typecheck, build, tests.

---

## 5. Validation

Un correctif n'est validé que si les quatre points suivants sont vérifiés — dans
cet ordre :

- [ ] le **test de non-régression** échoue sur `main` et passe sur la branche ;
- [ ] la **CI est verte** (les quatre étapes, pas seulement les tests) ;
- [ ] le scénario du ticket est **rejoué à la main en préproduction**, sur les
      images reconstruites (`make preprod-up`) ;
- [ ] les **journaux de préproduction** ne montrent plus l'erreur d'origine.

Puis : merge dans `main`, suppression de la branche, fermeture de l'issue en
citant le commit, et retrait de l'entrée du registre `CLAUDE.md §10` si elle
existait.

---

## 6. Outillage — commandes utiles

```bash
# Lancer / observer la préproduction
make preprod-up            # construit les images et démarre (web 3100, api 3101)
make preprod-health        # sonde API + base
make preprod-logs-api      # journaux JSON de l'API

# Suivre une requête précise d'un bout à l'autre
make preprod-logs-api | grep '"requestId":"<référence de l’écran d’erreur>"'

# Ne garder que les erreurs (jq facultatif)
make preprod-logs-api | grep '"level":"error"'

# Rejouer la taxonomie de labels sur un dépôt neuf
gh label create "priority: P1" --color d93f0b --description "Majeur : ..." --force
```

### Production — depuis le serveur (BUG-002)

```bash
make prod-ps              # (healthy) ou seulement Up ? c'est toute la difference
make prod-health          # la pile repond-elle, ou seulement le proxy ?
make prod-logs-api        # journaux JSON de production
make prod-migrate-status  # migrations reellement appliquees
```

> **Ce que BUG-002 a appris.** L'API annonçait la cause de sa panne, nommément
> et dès la première seconde. L'information est restée invisible faute d'une
> sonde pour aller la lire : le conteneur n'avait pas de `healthcheck`, donc
> `docker ps` affichait « Up » sur un service qui redémarrait en boucle, et le
> diagnostic est parti d'un `502` côté navigateur plutôt que d'un journal. La
> détection ne vaut que par ce qui la remonte — voir
> [`production.md`](production.md).

---

## 7. Traçabilité des contraintes

| Contrainte | Ce que la procédure y apporte                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------- |
| **C3**     | Le correctif passe la même barre de qualité que le reste (lint, typecheck, tests en CI)        |
| **C4**     | L'identifiant de corrélation est une entrée utilisateur validée ; aucune cause interne exposée |
| **C10**    | Les journaux rapportent les sources en panne, matière première du réglage de la dégradation    |
| **C11**    | Journaux sans donnée personnelle ; erreurs front remontées sans identité ni URL complète       |

---

## 8. Historique

| Défaut      | Sujet                                       | Issue | État                                                                     |
| ----------- | ------------------------------------------- | ----- | ------------------------------------------------------------------------ |
| **BUG-001** | `format:check` rouge sous Windows (CRLF/LF) | #87   | Corrigé le 29/08/2026 (`.gitattributes`)                                 |
| **BUG-002** | Production : `502` sur tout `/api/*` (P0)   | #106  | Configuration versionnée le 04/09/2026 ; OTP et import cyclable en cours |
