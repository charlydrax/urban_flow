# Module `privacy` — Limitation de la conservation (UF-603)

## Rôle

Applique la **durée de conservation** des données de déplacement (C8 — art. 5.1.e
RGPD). C'est le seul traitement du projet que personne ne déclenche : il doit
s'exécuter tout seul, y compris — et surtout — pour les comptes que plus personne
n'ouvre.

Le reste de la conformité RGPD vit là où l'utilisateur agit :

| Droit / obligation             | Où c'est implémenté                                         |
| ------------------------------ | ----------------------------------------------------------- |
| Consentement géolocalisation   | `modules/users` + `apps/web/features/planner`               |
| Accès, rectification           | `GET` / `PATCH /api/users/me`                               |
| Effacement (art. 17)           | `DELETE /api/users/me`                                      |
| Information (art. 12-13)       | `apps/web/app/confidentialite`                              |
| Chiffrement en transit         | HSTS + cookie `secure` (`main.ts`, `common/auth-cookie.ts`) |
| **Limitation de conservation** | **ce module**                                               |

Vue d'ensemble : [`docs/rgpd.md`](../../../../../docs/rgpd.md).

## Endpoints

**Aucun.** Les droits s'exercent depuis le profil, là où l'utilisateur est déjà —
pas dans un espace « RGPD » séparé qu'il faudrait aller chercher.

## Ce que fait la purge

`DataRetentionService` supprime chaque nuit à 3 h les lignes de `search_history`
plus anciennes que `SEARCH_HISTORY_RETENTION_DAYS` (365 jours).

La constante vient de [`@urbanflow/shared`](../../../../../packages/shared/src/privacy.ts)
et **de nulle part ailleurs** : la même valeur alimente la page « Politique de
confidentialité » de la PWA. Le délai annoncé à l'utilisateur ne peut donc pas
diverger de celui qui s'applique en base.

Ni les comptes ni les préférences ne sont purgés : ce sont des réglages, pas la
trace d'un comportement. Ils disparaissent quand l'utilisateur exerce son droit à
l'effacement.

### Pourquoi une tâche planifiée

Purger à l'écriture (« au prochain trajet enregistré, on nettoie les anciens »)
aurait évité une dépendance. Mais ce sont les **comptes dormants** qui posent le
problème : sans écriture, jamais de purge, et les trajets — la donnée la plus
ré-identifiable du schéma — resteraient indéfiniment. Une limitation de conservation
réservée aux utilisateurs actifs n'en est pas une.

### Créneau et coût

3 h du matin, hors heures de déplacement : la purge écrit sur la table que le
planificateur alimente, et un `DELETE` massif à 8 h 30 rallongerait le chemin
critique (C10).

Le filtre porte sur `created_at` seul, que l'index `(user_id, created_at)` ne couvre
pas. C'est assumé : la purge tourne une fois par jour hors charge, alors qu'un index
supplémentaire coûterait à **chaque** enregistrement de trajet (C5).

## Déclenchement manuel (recette)

`purgeExpiredSearchHistory(now?)` est publique et séparée du déclencheur `@Cron` :
elle s'appelle à la main, avec une horloge fixée, sans attendre 3 h du matin ni
instrumenter l'ordonnanceur.

## Dépendances

- `@nestjs/schedule` (`ScheduleModule.forRoot()` dans `app.module.ts`) — v6, la
  dernière lignée CommonJS : la v12 est ESM-only et ne se charge ni sous `nest build`
  (sortie CJS) ni sous ts-jest.
- `PrismaService` — modèle `SearchHistory` uniquement.
- `@urbanflow/shared` — `SEARCH_HISTORY_RETENTION_DAYS`.

## Contraintes couvertes

| Contrainte | Traduction dans le module                                                                   |
| ---------- | ------------------------------------------------------------------------------------------- |
| C8         | Limitation de la conservation (art. 5.1.e), durée unique partagée avec la politique publiée |
| C11        | Journal d'exploitation à base de compteurs — aucun identifiant, aucun lieu                  |
| C5 / C10   | Une requête par jour, hors heures de pointe, sans index supplémentaire à maintenir          |

## Tests

`data-retention.service.spec.ts` — la **borne** avant tout : une erreur de facteur
sur le seuil ne casse aucun type et ne lève aucune exception, mais supprimerait tout
l'historique de tout le monde, ou rien du tout. Le spec vérifie aussi que le filtre
ne porte que sur la date (pas de filtre utilisateur, sinon les comptes dormants
échappent à la purge) et qu'aucun compte ni profil n'est touché.
