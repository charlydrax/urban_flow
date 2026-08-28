# `apps/web` — Client PWA (Next.js)

## Rôle

Interface utilisateur d'UrbanFlow : planificateur d'itinéraires (F2) sur carte MapLibre,
authentification (F1), préférences de mobilité et tableau de bord carbone.

## Points clés

- **PWA & hors-ligne (C1/C10, UF-601)** : `public/manifest.json` + service worker maison
  (`sw.ts`, compilé vers `public/sw.js` par esbuild via `npm run build:sw`).
  Network-first avec repli cache pour les navigations et pour le **dernier itinéraire
  calculé** ; cache-first pour les assets de build, le manifest, les icônes et le
  **fond de carte déjà consulté** (borné à 250 entrées — C5). Un bandeau global
  « mode hors-ligne » (`components/offline/`) et une mention explicite sur les
  résultats rejoués évitent de faire passer un trajet périmé pour un calcul frais.
  Tableau complet des stratégies, recette et limites : `docs/pwa-offline.md`.
- **Carte (C5/C6, UF-201)** : MapLibre GL JS chargé en lazy (`components/map/lazy-map.tsx`,
  `ssr: false`) — exclu du bundle initial. Fond de carte résolu depuis
  l'environnement (`NEXT_PUBLIC_MAPTILER_KEY` / `NEXT_PUBLIC_MAP_STYLE_URL`,
  repli OpenStreetMap sans clé) : choix du fournisseur, coûts et accessibilité
  détaillés dans `components/map/README.md`.
- **Accessibilité (C7)** : layout sémantique, skip-link, focus visible, contrastes AA,
  `prefers-reduced-motion`.
- **API** : client typé `lib/api-client.ts` (cookies httpOnly — C11),
  contrats partagés importés depuis `@urbanflow/shared` (mêmes types que les DTO NestJS — C9).
- **Session (C4/C11, UF-106)** : toutes les pages sont **privées par défaut**
  (`middleware.ts`) sauf `/login` et `/register` ; un `401` de l'API purge la session et
  renvoie vers la connexion en mémorisant la page demandée. Détail et périmètre de
  confiance : `features/auth/README.md`.

## Structure

```
app/           # App Router (layout accessible, pages)
components/    # UI transverse (carte MapLibre, indicateur hors-ligne — README par dossier, enregistrement SW)
features/      # auth/ (câblé — UF-105/106), planner/, profile/, carbon/ (stubs)
lib/           # client API, session, géolocalisation (C6), helpers
middleware.ts  # protection des routes privées (UF-106)
sw.ts          # service worker (C1, C10) — voir docs/pwa-offline.md
```

## Commandes

`npm run dev` (compile le SW puis lance Next), `npm run build`, `npm run lint`,
`npm run test` (Vitest), `npm run typecheck:sw`.
