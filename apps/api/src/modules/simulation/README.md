# Module `simulation` — mode simulation de trajet (UF-701)

Outillage **interne** : il rejoue un itinéraire sur une position fictive, pour
que le parcours complet — planifier, partir, arriver, voir l'empreinte se
cumuler — soit démontrable sans marcher réellement de la Part-Dieu à Bellecour.

C'est le seul module de l'API entièrement réservé à un rôle.

## Endpoint

| Méthode | Chemin                 | Accès        |
| ------- | ---------------------- | ------------ |
| `POST`  | `/api/simulation/trip` | rôle `admin` |

**Corps** — les segments de l'itinéraire retenu, réduits à ce que
l'interpolation consomme (`SimulateTripRequest` dans `@urbanflow/shared`) :

```jsonc
{
  "segments": [
    {
      "durationMinutes": 3,
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [4.8596, 45.7605],
          [4.8571, 45.7592],
        ],
      },
    },
    {
      "durationMinutes": 9,
      "geometry": {
        "type": "LineString",
        "coordinates": [
          /* … */
        ],
      },
    },
  ],
}
```

Pas de `userId` : le demandeur est le porteur du JWT, et son rôle est relu en
base (C4). Pas de mode ni d'empreinte non plus — ce service ne valorise rien.

**Réponse** — la trace complète, prête à rejouer :

```jsonc
{
  "stepIntervalMs": 2000,
  "ticks": [{ "index": 0, "lat": 45.7605, "lng": 4.8596, "segmentIndex": 0, "elapsedSeconds": 0 }],
}
```

## Les trois réponses

| Appel                                | Réponse | Rendu par      |
| ------------------------------------ | ------- | -------------- |
| Sans jeton, ou jeton invalide/expiré | `401`   | `JwtAuthGuard` |
| Compte `user` authentifié            | `403`   | `RolesGuard`   |
| Compte `admin` authentifié           | `200`   | —              |

Le `403` est rendu par le `RolesGuard`, qui relit le rôle **en base** et non
dans le jeton : un compte rétrogradé perd l'accès à l'appel suivant, sans
attendre l'expiration de sa session (C4 / OWASP A01). Le test
`common/guards/roles.guard.spec.ts` fige le cas décisif — un jeton qui
revendique `admin` alors que la base dit `user` est refusé.

## Pourquoi ce mode est réservé

Simuler un déplacement, c'est le faire **compter** : le guidage consomme les
positions fictives comme des mesures GPS, atteint la destination, et le trajet
entre dans le suivi carbone personnel (UF-807). Offrir cela à tout le monde
reviendrait à laisser chacun se composer un bilan — exactement ce qu'UF-505
refuse en n'acceptant aucun gramme venu du navigateur.

Côté interface, le bouton « Simuler le déplacement » n'est peint que pour un
exploitant. C'est du **confort**, pas de la sécurité : la frontière est le
guard, et elle tient qu'on passe par l'écran, par Swagger ou par `curl`.

## Comment la trace est construite

Les pas découpent le **temps** du trajet, pas sa longueur : un pas vaut donc
quelques mètres à pied et quelques centaines en métro. C'est précisément ce
qu'on veut montrer — la part du trajet passée dans chaque mode, et donc
l'endroit où part le CO₂.

Le nombre de pas est **fixe** (`SIMULATION_TICKS = 30`), la cadence aussi
(`SIMULATION_STEP_INTERVAL_MS = 2000`) : une démonstration d'une minute, quelle
que soit la longueur du trajet. La vitesse à l'écran n'est donc pas à
l'échelle ; les proportions entre segments, elles, le sont.

Le **dernier pas tombe exactement sur le dernier point du tracé**. C'est la
propriété dont tout le reste dépend : sans elle, le guidage ne franchit jamais
son rayon d'arrivée (40 m) et rien de ce qui découle de l'arrivée n'est
observable.

Un segment **sans tracé** — `RouteSegment.geometry` est optionnel au contrat —
est traversé sans bouger : son temps s'écoule, la position reste au dernier
point connu. C'est ce que fait un usager qui attend son bus, et c'est
préférable à une ligne droite inventée entre deux arrêts (C9).

## Dépendances

**Aucune.** Ni Prisma, ni Service Carbone, ni source de transport : la trace se
déduit entièrement des segments soumis. Le module ne lit ni n'écrit rien en
base — ce qui sera consigné du trajet simulé le sera par le chemin normal, à
l'arrivée du guidage (UF-807), exactement comme pour un trajet réel (C8).

Le contrôle d'accès ne vit pas ici non plus : c'est le `RolesGuard` global
(`common/guards/roles.guard.ts`) qui lit le `@Roles(UserRole.ADMIN)` posé sur
le contrôleur.

## Ce que le module ne fait pas

**Il ne calcule aucune empreinte.** Le compteur CO₂ du guidage se déduit de la
progression, côté client, à partir des grammes que le Service Carbone a déjà
publiés sur chaque segment (étape 6 du flux). Recalculer ici donnerait deux
autorités sur le même chiffre, et donc, tôt ou tard, deux chiffres.

**Il ne recalcule aucun itinéraire.** Il reçoit celui que l'usager a retenu et
le rejoue. Même règle que `lib/route-progress.ts` côté client.

## Contraintes couvertes

| Contrainte | Comment                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C4**     | Endpoint réservé par rôle, décision prise sur la base et non sur une revendication du jeton ; géométries entrantes bornées (domaine WGS84, nombre de points, nombre de segments) |
| **C5**     | Une seule requête pour toute la démonstration — le client anime la trace lui-même, il ne redemande rien à chaque pas                                                             |
| **C8**     | Aucune écriture : la simulation ne laisse aucune trace du déplacement fictif ; ce qui est consigné passe par le chemin normal de l'arrivée                                       |
| **C9**     | Géométries GeoJSON `[lng, lat]` (RFC 7946) en entrée comme en sortie ; endpoint documenté dans Swagger comme les autres                                                          |
