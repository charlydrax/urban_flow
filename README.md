# UrbanFlow Mobility

Plateforme de mobilité urbaine intelligente : itinéraires **multimodaux** (transports en commun,
vélos, trottinettes, covoiturage) avec **empreinte carbone** affichée pour chaque option, afin
d'orienter les usagers vers les mobilités douces.

> Projet réalisé pour le Titre RNCP 36146 — Concepteur Développeur de Solutions Digitales
> (T6 CDSD), Digital Campus Paris, B3DEV, session septembre 2026.

## Architecture

Monorepo npm workspaces :

```
urbanflow/
├── apps/
│   ├── web/        # Client PWA — Next.js (App Router) + TypeScript + TailwindCSS + MapLibre GL JS
│   └── api/        # API Gateway — NestJS + TypeScript + Prisma (PostgreSQL + PostGIS)
├── packages/
│   └── shared/     # Types TypeScript partagés front/back (DTO, itinéraires, TransportMode)
├── docs/           # Diagrammes UML, specs, captures
├── docker-compose.yml  # Base PostGIS de développement
└── CLAUDE.md       # Contexte projet & conventions
```

- **apps/api** : monolithe modulaire NestJS — modules `auth` (JWT, F1), `users` (profils, F1),
  `routes` (planificateur, F2), `search-history` (trajets enregistrés en géométries PostGIS, F2),
  `transport` (GTFS/GBFS, F3), `carbon` (empreinte CO₂).
  API REST documentée via Swagger (C9).
- **apps/web** : PWA installable (C1), mobile-first (C2), accessible WCAG 2.1 AA (C7),
  carte MapLibre chargée en lazy-load (C5). Le fond de carte est configurable par
  variable d'environnement — aucune clé de fournisseur dans le dépôt (C4) ; sans
  configuration, repli automatique sur les tuiles OpenStreetMap
  (voir [`apps/web/components/map/README.md`](apps/web/components/map/README.md)).
- **packages/shared** (`@urbanflow/shared`) : contrats TypeScript partagés (DTO d'itinéraires,
  auth, carbone, enum `TransportMode`) — une seule définition du contrat front/back (C9).
  Les DTO NestJS implémentent ces interfaces ; le client web les importe telles quelles.
- **Base de données** : PostgreSQL + extension PostGIS (requêtes géospatiales), pilotée par Prisma.

## Prérequis

- **Node.js ≥ 22** et npm ≥ 10
- **Docker Desktop** (pour la base PostGIS locale) — **doit être démarré** avant l'étape 3.

## Démarrage rapide

```bash
# 1. Installer les dépendances (racine du monorepo)
#    Compile aussi packages/shared automatiquement (script `prepare`).
npm install

# 2. Configurer les variables d'environnement (jamais de secrets commités)
#    À faire une seule fois, puis renseigner les valeurs (mot de passe, JWT_SECRET).
cp .env.example .env                    # base de données (docker compose)
cp apps/api/.env.example apps/api/.env  # API (DATABASE_URL, JWT_SECRET...)
cp apps/web/.env.example apps/web/.env  # Front (NEXT_PUBLIC_API_URL, fond de carte)

# 3. Lancer la base PostGIS (Docker Desktop doit tourner)
#    Au premier démarrage, docker/initdb/ active l'extension PostGIS
#    automatiquement (CREATE EXTENSION IF NOT EXISTS postgis)
docker compose up -d

# 4. Appliquer les migrations (active aussi l'extension PostGIS)
npm run db:migrate

# 5. Démarrer l'API (http://localhost:3001) ET le front (http://localhost:3000)
#    dans un seul terminal (concurrently) — Swagger sur http://localhost:3001/api/docs
npm run dev
```

> Alternative : `npm run dev:api` et `npm run dev:web` lancent chaque app séparément
> (deux terminaux, mode watch).

### Vérifier que tout tourne

| Service      | URL / commande                 | Attendu                                           |
| ------------ | ------------------------------ | ------------------------------------------------- |
| Base PostGIS | `docker compose ps`            | conteneur `urbanflow-db` **healthy**, port `5433` |
| API Gateway  | http://localhost:3001/api/docs | Swagger (200)                                     |
| Front PWA    | http://localhost:3000          | page d'accueil UrbanFlow (200)                    |

> ℹ️ La base est exposée sur le **port hôte 5433** (et non 5432) pour éviter un conflit
> avec un PostgreSQL déjà installé localement — voir `POSTGRES_PORT` dans `.env` et la
> `DATABASE_URL` de `apps/api/.env`.

### Avec le Makefile (raccourcis Docker)

Si `make` est disponible (Git Bash / WSL ; sous Windows : `choco install make`) :

```bash
make up        # démarre la base PostGIS en arrière-plan
make migrate   # attend la base prête puis applique les migrations Prisma
make logs      # suit les logs des conteneurs
make down      # arrête les conteneurs (volumes conservés)
make help      # liste toutes les cibles
```

Les serveurs applicatifs restent lancés via npm (`npm run dev:api` / `npm run dev:web`).

## Commandes utiles

| Commande                              | Description                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                         | Démarre l'API (port 3001) **et** le front (port 3000) dans un seul terminal |
| `npm run dev:api` / `npm run dev:web` | Démarre l'API / le front séparément                                         |
| `npm run build`                       | Build de `packages/shared` puis des deux applications                       |
| `npm run build:shared`                | Recompile uniquement les types partagés (`@urbanflow/shared`)               |
| `npm run lint`                        | Lint strict (ESLint + typescript-eslint) du monorepo                        |
| `npm run test`                        | Tests (Jest côté API, Vitest côté web)                                      |
| `npm run format`                      | Formate tout le code avec Prettier                                          |
| `npm run db:migrate`                  | Applique les migrations Prisma (crée la migration en dev si besoin)         |
| `npm run db:generate`                 | Régénère le client Prisma après modification du schéma                      |
| `npm run db:studio`                   | Explorateur visuel de la base (Prisma Studio)                               |

## Fonctionnalités (périmètre MVP)

| ID  | Fonctionnalité                                    | Statut            |
| --- | ------------------------------------------------- | ----------------- |
| F1  | Inscription / connexion + profils de mobilité     | squelette (stubs) |
| F2  | Planificateur d'itinéraires multimodal            | squelette (stubs) |
| F3  | Intégration GTFS + GBFS                           | squelette (stubs) |
| —   | Calculateur d'empreinte carbone + suivi personnel | squelette (stubs) |

## Qualité de code & contribution

Lint strict (ESLint + Prettier partagés), hooks Git (Husky : lint-staged en `pre-commit`,
commitlint en `commit-msg`) et convention **Conventional Commits** — voir
[`CONTRIBUTING.md`](CONTRIBUTING.md) et [`docs/git-workflow.md`](docs/git-workflow.md).

## Contraintes techniques

Le projet est évalué sur les contraintes **C1 → C12** (PWA, responsive, normes, OWASP,
éco-conception, géolocalisation, accessibilité, RGPD, interopérabilité, performances,
sécurité des données, normes transport). Chaque service/composant documente dans son
TSDoc les contraintes qu'il couvre — voir `CLAUDE.md` section 5.
