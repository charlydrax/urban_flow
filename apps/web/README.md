# `apps/web` — Client PWA (Next.js)

## Rôle

Interface utilisateur d'UrbanFlow : planificateur d'itinéraires (F2) sur carte MapLibre,
authentification (F1), préférences de mobilité et tableau de bord carbone.

## Points clés

- **PWA (C1)** : `public/manifest.json` + service worker maison (`sw.ts`, compilé vers
  `public/sw.js` par esbuild via `npm run build:sw`). Stratégie : network-first avec
  repli cache pour les navigations et pour le **dernier itinéraire calculé** (C10).
- **Carte (C5)** : MapLibre GL JS chargé en lazy (`components/map/lazy-map.tsx`,
  `ssr: false`) — exclu du bundle initial.
- **Accessibilité (C7)** : layout sémantique, skip-link, focus visible, contrastes AA,
  `prefers-reduced-motion`.
- **API** : client typé `lib/api-client.ts` (cookies httpOnly — C11),
  types miroirs dans `lib/api-types.ts`.

## Structure

```
app/         # App Router (layout accessible, pages)
components/  # UI transverse (carte, enregistrement SW)
features/    # auth/, planner/, profile/, carbon/ (stubs)
lib/         # client API, géolocalisation (C6), helpers
sw.ts        # service worker (C1, C10)
```

## Commandes

`npm run dev` (compile le SW puis lance Next), `npm run build`, `npm run lint`,
`npm run test` (Vitest), `npm run typecheck:sw`.
