# Image du client PWA UrbanFlow — préproduction (UF-607).
#
# Contexte de build attendu : la RACINE du dépôt (`dev/`), comme pour l'API —
# le front consomme lui aussi `@urbanflow/shared` par lien de workspace.
#
# Sortie `standalone` de Next.js : le build trace les modules réellement
# importés et n'emporte qu'eux. L'image finale pèse une fraction d'un
# `node_modules` complet (C5), et ne contient aucune source.

# ---------------------------------------------------------------- compilation
FROM node:22-alpine AS builder

WORKDIR /app

# Les manifestes des DEUX applications sont copiés, même si une seule est bâtie
# ici : npm refuse d'installer un monorepo dont il ne trouve pas tous les
# workspaces déclarés au lockfile.
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

COPY apps/web apps/web

# ⚠️ Variable de BUILD, pas d'exécution : Next.js inline les `NEXT_PUBLIC_*`
# dans le bundle envoyé au navigateur. La changer après coup n'a aucun effet —
# il faut reconstruire l'image. C'est l'URL vue depuis le NAVIGATEUR de
# l'usager (`localhost:3101`), et non depuis le réseau Docker : le code qui
# l'utilise s'exécute sur le poste du testeur, pas dans le conteneur.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Active la sortie autonome (voir next.config.ts) : uniquement ici, pour ne pas
# changer le comportement des builds de développement et de CI.
ENV NEXT_OUTPUT=standalone

RUN npm run build --workspace packages/shared \
  && npm run build --workspace apps/web

# ------------------------------------------------------------------ exécution
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# La sortie autonome reproduit l'arborescence du monorepo : le serveur se
# trouve donc dans `apps/web/`, et les fichiers statiques doivent être posés
# à côté de lui — Next ne les inclut pas, il les sert.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
