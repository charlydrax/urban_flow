# Image de l'API Gateway UrbanFlow — préproduction (UF-607).
#
# Contexte de build attendu : la RACINE du dépôt (`dev/`), pas `apps/api`.
# L'API dépend de `packages/shared` par un lien de workspace npm : bâtir depuis
# `apps/api` seul donnerait une image qui ne peut pas résoudre `@urbanflow/shared`.
#
# Deux étapes : on compile avec l'outillage complet, on n'expédie que le
# résultat. L'image finale ne contient ni sources TypeScript, ni compilateur,
# ni CLI Nest/Prisma (C5 — éco-conception : moins d'octets à transférer et à
# stocker ; C4 — moins d'outils embarqués, moins de surface offerte).

# ---------------------------------------------------------------- compilation
FROM node:22-alpine AS builder

WORKDIR /app

# Manifestes d'abord, sources applicatives ensuite : tant que les dépendances ne
# changent pas, Docker réutilise le cache de `npm ci` et la reconstruction ne
# coûte que la compilation. Les manifestes des DEUX applications sont copiés,
# même si une seule est bâtie ici : npm refuse d'installer un monorepo dont il
# ne trouve pas tous les workspaces déclarés au lockfile.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# `packages/shared` est copié ENTIER avant l'installation, sources comprises,
# alors que les autres workspaces n'apportent que leur manifeste. Ce n'est pas
# une inconséquence : ce paquet déclare un script `prepare` qui le compile, et
# npm l'exécute pendant `npm ci` pour tout workspace lié. Sans ses sources ni
# son tsconfig à ce moment-là, l'installation échoue (« TS5058: The specified
# path does not exist: 'tsconfig.json' »). Le paquet ne contient que des
# contrats TypeScript : le cache d'installation ne se perd donc que lorsque le
# contrat partagé change, ce qui est rare et significatif.
COPY packages/shared packages/shared

RUN npm ci

COPY apps/api apps/api

# `db:generate` produit le client Prisma typé : il ne demande AUCUNE base de
# données, seulement le schéma — les migrations, elles, sont appliquées
# séparément (`make preprod-migrate`), parce qu'un build ne doit pas dépendre
# d'un serveur joignable.
RUN npm run build --workspace packages/shared \
  && npm run db:generate --workspace apps/api \
  && npm run build --workspace apps/api \
  && npm prune --omit=dev

# ------------------------------------------------------------------ exécution
FROM node:22-alpine AS runtime

WORKDIR /app

# `NODE_ENV=production` allume les chemins optimisés de Nest et d'Express.
# `APP_ENV` est distinct (voir config/env.validation.ts) : la préproduction se
# comporte comme la production, mais ses journaux doivent le dire.
ENV NODE_ENV=production \
    APP_ENV=preproduction \
    LOG_FORMAT=json

# Le lien symbolique `node_modules/@urbanflow/shared` pointe vers
# `packages/shared` : les deux sont copiés, sinon l'import se casse au démarrage.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
# Schéma et migrations : embarqués pour que l'image sache décrire la base
# qu'elle attend — utile pour rejouer une migration depuis le conteneur.
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

# Utilisateur non privilégié fourni par l'image Node (C4 / OWASP A05 : un
# processus applicatif n'a aucune raison d'être root dans son conteneur).
USER node

EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
