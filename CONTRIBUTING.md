# Contribuer à UrbanFlow Mobility

Règles de qualité de code du projet (UF-008, contrainte **C3 — normes et standards**).
Pour la stratégie de branches et la CI, voir [`docs/git-workflow.md`](docs/git-workflow.md).

## Lint & formatage

- **ESLint** (flat config) avec une base stricte partagée par tout le monorepo :
  [`eslint.config.base.mjs`](eslint.config.base.mjs) — preset `typescript-eslint` **strict**,
  `no-explicit-any` en erreur, conflits Prettier désactivés en dernier.
  Chaque workspace l'étend dans son propre `eslint.config.mjs`
  (`apps/api`, `apps/web` via le preset Next.js, `packages/shared`).
- **Prettier** : configuration unique à la racine ([`.prettierrc`](.prettierrc)),
  exclusions dans [`.prettierignore`](.prettierignore).

```bash
npm run lint          # lint strict de tout le monorepo (doit passer sans erreur)
npm run format        # formate tout le code
npm run format:check  # vérifie le formatage sans modifier
```

## Fins de ligne — LF partout

[`.gitattributes`](.gitattributes) déclare `* text=auto eol=lf` : tout fichier texte est
stocké **et extrait** en LF, quelle que soit la valeur de `core.autocrlf` sur la machine.
Sans cette règle, un poste Windows par défaut extrait le dépôt en CRLF et
`npm run format:check` échoue en permanence sur des fichiers non modifiés, puisque
`.prettierrc` impose `"endOfLine": "lf"` (BUG-001, #87).

Rien à configurer côté contributeur. Une seule commande facultative, une fois par clone,
pour que `git blame` saute le commit de renormalisation :

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

GitHub applique ce fichier automatiquement dans son interface de blame.

## Hooks Git (Husky)

Installés automatiquement par `npm install` (script `prepare`). Ils s'exécutent en local
avant que le code ne parte vers la CI — première ligne de défense C3.

| Hook         | Outil           | Effet                                                                                                                                                  |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pre-commit` | **lint-staged** | `eslint --fix` + `prettier --write` sur les **fichiers stagés uniquement** ; le commit est **bloqué** si une erreur de lint n'est pas auto-corrigeable |
| `commit-msg` | **commitlint**  | Rejette tout message de commit qui ne respecte pas Conventional Commits                                                                                |

La configuration lint-staged est déclarée par workspace (clé `lint-staged` de chaque
`package.json`) : chaque fichier stagé est traité avec la config ESLint de son workspace.
Ne contourne pas les hooks (`--no-verify`) : la CI ré-exécute le lint de toute façon.

## Convention de commits (Conventional Commits)

Format : `type(scope): sujet à l'impératif, en anglais` + référence du ticket `(UF-xxx)`.

| Type       | Usage                                       |
| ---------- | ------------------------------------------- |
| `feat`     | Nouvelle fonctionnalité                     |
| `fix`      | Correction de bug                           |
| `docs`     | Documentation seule                         |
| `refactor` | Refactoring sans changement de comportement |
| `test`     | Ajout/modification de tests                 |
| `chore`    | Outillage, dépendances, configuration       |
| `ci`       | Pipeline d'intégration continue             |
| `style`    | Formatage sans impact sur le code           |

Exemples valides :

```
feat(api): add DB ping to /api/health endpoint (UF-005)
chore: enforce lint and commit convention with git hooks (UF-008)
fix(web): serve fresh chunks in dev when service worker is active
```

La règle est appliquée par le hook `commit-msg`
([`commitlint.config.mjs`](commitlint.config.mjs), preset `@commitlint/config-conventional`).

## Branches & Pull Requests

Résumé (détails dans [`docs/git-workflow.md`](docs/git-workflow.md)) :

1. Partir de `main` à jour : `git checkout main && git pull`.
2. Une branche par ticket : `feat/uf-xxx-description-courte`
   (autres préfixes : `fix/`, `docs/`, `chore/`).
3. Ouvrir une PR vers `main` ; la CI (lint + build + tests) doit être **verte** avant merge.
