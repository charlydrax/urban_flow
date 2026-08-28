# `components/offline` — Indicateur de mode hors-ligne (UF-601)

## Rôle

Rendre **visible** l'état hors-ligne de la PWA, sur toutes les pages. C'est la
partie « interface » de la couche hors-ligne ; la partie « données » est dans
[`sw.ts`](../../sw.ts), et le contrat qui les relie dans
[`lib/offline.ts`](../../lib/offline.ts).

Contraintes couvertes : **C10** (connectivité variable annoncée sans bloquer),
**C7** (région live, ton non alarmiste, contraste AA), **C1** (complète le service worker).

## Contenu

| Fichier                | Rôle                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `use-online-status.ts` | Hook réactif sur `navigator.onLine` (`useSyncExternalStore`) |
| `offline-banner.tsx`   | Bandeau global monté dans `app/layout.tsx`, sous l'en-tête   |

## Dépendances

- `lib/offline.ts` — textes affichés et contrat d'en-tête avec le service worker.
  Le composant **peint**, il ne rédige pas : le texte reste dans un module pur, testé.
- Aucun appel réseau, aucune dépendance à l'API.

## Points d'attention

- **`useSyncExternalStore` et pas `useState`/`useEffect`** : `navigator.onLine` est une
  source extérieure à React. Une coupure survenue entre le rendu serveur et
  l'hydratation passerait sinon inaperçue jusqu'au retour du réseau.
- **L'instantané serveur vaut `true`** : le HTML envoyé ne doit jamais contenir le
  bandeau, sinon une page servie depuis le cache du worker l'afficherait à quelqu'un
  dont la connexion est revenue.
- **La région live est montée en permanence**, vide quand tout va bien — une région
  insérée au moment de la coupure n'est pas annoncée par les lecteurs d'écran.
- **`navigator.onLine` ment parfois** (portail captif) : cet indicateur est un
  complément, la vérité reste l'échec de la requête (`classifyPlanFailure`) et
  l'en-tête posé par le worker.

## Voir aussi

- [`docs/pwa-offline.md`](../../../../docs/pwa-offline.md) — stratégies de cache,
  recette complète et limites connues.
