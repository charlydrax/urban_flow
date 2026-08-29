# Module `diagnostics` — remontée des erreurs de l'interface (UF-607)

Point d'entrée des pannes survenues **dans le navigateur**, que le serveur ne
voit jamais autrement : quand un écran de la PWA plante, la requête d'API a
réussi, c'est le rendu qui a échoué.

## Endpoint

| Méthode | Chemin                           | Auth        | Plafond       | Réponse |
| ------- | -------------------------------- | ----------- | ------------- | ------- |
| `POST`  | `/api/diagnostics/client-errors` | `@Public()` | 10 req/min/IP | `204`   |

### Pourquoi ouvert

Une session expirée et un plantage de l'écran de connexion sont précisément les
cas qu'on veut voir. Exiger un JWT reviendrait à n'observer que les pannes des
usagers connectés — c'est-à-dire à être aveugle là où ça casse le plus. En
contrepartie, l'endpoint est **strictement plafonné** et **n'écrit rien en
base** : il ne peut ni saturer le stockage, ni servir de canal d'exfiltration.
Le plafond serré n'est pas cosmétique — noyer les journaux sous du bruit est une
façon connue d'y effacer sa trace (OWASP A09).

### Corps accepté

```json
{
  "message": "Cannot read properties of undefined (reading 'segments')",
  "name": "TypeError",
  "screen": "planner",
  "requestId": "5f1d1c0a-2a6e-4f3b-9a8f-2c1d3e4f5a6b",
  "digest": "1873452901"
}
```

- **`screen`** est une liste fermée (`planner`, `login`, `register`, `profile`,
  `impact`, `privacy`, `unknown`), **pas** un chemin d'URL : une URL recopiée
  telle quelle emporterait la chaîne de requête, donc potentiellement une
  adresse de départ ou d'arrivée (C8/C11).
- **`requestId`** désigne le **dernier appel d'API** observé par le front. C'est
  la clé de jointure : le journal montre alors la requête et l'erreur d'écran
  qu'elle a provoquée sous la même valeur.
- **`digest`** est l'empreinte produite par Next.js pour une erreur de rendu
  serveur.
- `requestId` et `digest` sont contraints au même alphabet que l'en-tête
  `X-Request-Id` : ce qui arrive ici finit dans un journal, un saut de ligne y
  forgerait une fausse entrée.

## Ce qu'il fait de la donnée

Il la **journalise**, et rien d'autre. Une ligne de niveau `warn`, contexte
`ClientError`, dans le même flux structuré que les erreurs serveur :

```json
{
  "ts": "…",
  "level": "warn",
  "msg": "screen=planner name=TypeError apiRequestId=smoke-test-42 message=…",
  "context": "ClientError",
  "requestId": "3b2e…",
  "env": "preproduction"
}
```

Aucune persistance, aucun service tiers. Envoyer les erreurs d'un usager chez un
sous-traitant hors périmètre demanderait une base légale, une mention au
registre et un transfert documenté (C8) ; pour le volume d'un MVP, une ligne
dans nos propres journaux suffit et reste chez nous (C11).

## Côté client

- `apps/web/lib/error-reporting.ts` — construit le signalement et l'envoie
  (`keepalive`, sans cookie de session, échecs avalés).
- `apps/web/app/error.tsx` — frontière d'erreur des pages : rend la main à
  l'usager et affiche la référence à recopier.
- `apps/web/app/global-error.tsx` — dernier filet, quand c'est le layout racine
  qui casse.

## Tests

```bash
cd apps/api && npx jest src/critical-paths.e2e.spec.ts   # 204 attendu, 400 sur écran inconnu
cd apps/web && npx vitest run lib/error-reporting.test.ts
```

## Contraintes couvertes

C4 (entrée validée, endpoint plafonné), C8 (minimisation : ni identité, ni URL,
ni cookie), C10 (un signalement perdu ne dégrade jamais l'écran de l'usager),
C11 (journalisation sans donnée personnelle).

Procédure complète : [`docs/bug-process.md`](../../../../../docs/bug-process.md).
