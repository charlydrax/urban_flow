# Workflow Git & CI — UrbanFlow Mobility (UF-009)

Stratégie de branches et intégration continue du projet. Sert de référence pour la
partie « environnement et outils de travail » du dossier T6.

## Stratégie de branches

```
main ──●──────●──────────●────► (stable, protégée)
        \    /            \
         ●──●              ●──● feat/uf-010-...
     feat/uf-009-git-workflow-ci
```

- **`main`** : branche stable, protégée. On n'y pousse jamais directement — tout
  passe par une Pull Request validée par la CI.
- **Branches de fonctionnalité** : une branche par ticket, nommée
  **`feat/uf-xxx-description-courte`** (ex. `feat/uf-009-git-workflow-ci`).
  Le numéro `uf-xxx` correspond au ticket GitHub (UF-001, UF-002, …).
- Autres préfixes possibles : `fix/` (correctif), `docs/` (documentation seule),
  `chore/` (outillage).

> Note : les branches historiques des premiers sprints utilisent le préfixe
> `feature/uf-xxx-...` ; la nomenclature retenue à partir de UF-009 est
> `feat/uf-xxx-...` (alignée sur les types Conventional Commits).

## Cycle de vie d'un ticket

1. `git checkout main && git pull` — partir d'une base à jour.
2. `git checkout -b feat/uf-xxx-description` — créer la branche du ticket.
3. Développer, avec des commits **Conventional Commits** en anglais :
   `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` (+ référence `(UF-xxx)`).
4. `git push -u origin feat/uf-xxx-description` puis ouvrir une **Pull Request**
   vers `main` (titre = ticket, description = résumé + recette).
5. La **CI doit être verte** (lint + build + tests) avant merge.
6. Merge dans `main`, suppression de la branche distante.

## Intégration continue (GitHub Actions)

Fichier : [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
Déclenchée sur **chaque push** (toutes branches) et chaque **PR vers `main`**.

| Job | Étapes | Rôle |
|-----|--------|------|
| `lint-build` | `npm ci` → `prisma generate` → `npm run lint` → `npm run build` | Vérifie normes de code (C3) et compilation du front (Next.js), du back (NestJS) et du package partagé |
| `test` | `npm ci` → `prisma generate` → build shared → `npm run test` | Exécute Jest (api) et Vitest (web) — prêt pour les sprints suivants |

Particularités :

- **Node 22** (aligné sur `engines` du `package.json` racine) avec cache npm.
- **`prisma generate`** est exécuté avant lint/build : les services NestJS
  importent les types `@prisma/client` ; aucune base de données n'est requise.
- **`NEXT_PUBLIC_API_URL`** est injectée au build du front : `next build` tourne
  en `NODE_ENV=production` et le client API applique un fail-fast si l'URL est
  absente (UF-004, C4).
- **`concurrency`** annule les runs obsolètes sur une même branche (C5,
  éco-conception : pas de minutes CI gaspillées).

## Recette du ticket UF-009

- [x] La CI passe au vert sur `main` (après merge de la PR).
- [x] Un push avec une erreur de build fait échouer la CI (le job `lint-build`
      échoue si `eslint`, `tsc`, `nest build` ou `next build` échouent).
- [x] Les branches suivent la nomenclature `feat/uf-xxx-description`.
