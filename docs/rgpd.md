# RGPD & protection des données de déplacement (UF-603)

Registre des traitements d'UrbanFlow, durées de conservation, mesures de protection
et exercice des droits — **avec, pour chaque ligne, le fichier qui l'implémente**.

Contraintes couvertes : **C8** (RGPD : consentement, minimisation, effacement,
politique de confidentialité), **C11** (sécurité des données de déplacement,
chiffrement en transit, journaux sans donnée personnelle), **C4** (cloisonnement
des comptes).

Code :
[`packages/shared/src/privacy.ts`](../packages/shared/src/privacy.ts) (durées de conservation),
[`apps/api/src/modules/privacy/`](../apps/api/src/modules/privacy/) (purge automatique),
[`apps/api/src/modules/users/`](../apps/api/src/modules/users/) (droit à l'effacement),
[`apps/api/src/common/auth-cookie.ts`](../apps/api/src/common/auth-cookie.ts) (cookie de session),
[`apps/web/app/confidentialite/page.tsx`](../apps/web/app/confidentialite/page.tsx) (politique publiée),
[`apps/web/features/planner/use-user-location.ts`](../apps/web/features/planner/use-user-location.ts) (consentement géoloc).

---

## 1. Registre : ce qui est réellement stocké

Chaque ligne correspond à une colonne du schéma Prisma. Le registre est court **parce
que le schéma l'est** : ni nom, ni prénom, ni téléphone, ni date de naissance — rien
de tout cela n'est nécessaire pour calculer un itinéraire (minimisation, art. 5.1.c).

| Donnée                                   | Table / colonne                      | Finalité                                | Base légale  | Conservation                           |
| ---------------------------------------- | ------------------------------------ | --------------------------------------- | ------------ | -------------------------------------- |
| Adresse e-mail                           | `users.email`                        | Identifier le compte, authentifier      | Contrat      | Jusqu'à suppression du compte          |
| Empreinte du mot de passe                | `users.password_hash`                | Protéger l'accès (argon2, jamais clair) | Contrat      | Jusqu'à suppression du compte          |
| Consentement géolocalisation             | `users.consent_at`                   | Prouver l'accord **et sa date**         | Consentement | Jusqu'à révocation ou suppression      |
| Préférences de mobilité                  | `mobility_profiles.*`                | Adapter le calcul d'itinéraire          | Contrat      | Jusqu'à suppression du compte          |
| Besoin PMR (donnée de santé)             | `mobility_profiles.reduced_mobility` | Itinéraires accessibles (C12)           | Consentement | Jusqu'à désactivation ou suppression   |
| Trajets recherchés (départ/arrivée, CO₂) | `search_history.*`                   | Trajets récents + bilan carbone         | Contrat      | **12 mois**, purge automatique         |
| Position instantanée                     | _aucune_                             | Pré-remplir le départ, centrer la carte | Consentement | **Jamais persistée** (navigateur seul) |

Deux lignes méritent d'être lues deux fois.

**La position n'est pas stockée.** Elle est lue par le navigateur, utilisée pour
remplir le champ « Départ » et centrer la carte, puis oubliée à la fermeture de
l'onglet. Ce que nous conservons, ce sont les **trajets recherchés** — un point de
départ et un point d'arrivée choisis — pas une trace de déplacement minute par
minute. Il n'y a aucun `watchPosition` dans le code.

**Le besoin PMR est une donnée de santé** (art. 9). Elle est facultative, activée
par l'utilisateur seul, utilisée uniquement pour pondérer les itinéraires, et jamais
journalisée.

---

## 2. Consentement à la géolocalisation

Recueilli en trois temps, dans cet ordre — c'est l'ordre qui fait le consentement,
pas les textes :

1. **Rien ne part au chargement.** La permission navigateur n'est jamais demandée
   à l'ouverture d'une page, seulement au clic sur « Me localiser ».
2. **On explique avant de demander.** Au premier clic, un panneau dit quelle donnée,
   pour quoi faire, comment revenir en arrière — et renvoie vers cette politique.
   Le refus n'écrit rien du tout : un refus ne se stocke pas.
3. **L'accord est horodaté côté serveur.** `PATCH /api/users/me` pose
   `users.consent_at` avec l'horloge du serveur, jamais celle du poste client.

Corollaire assumé : **si l'API est injoignable, on ne géolocalise pas un utilisateur
connecté.** Sans possibilité de tracer le consentement, la collecte n'a pas lieu.
L'application reste utilisable — la saisie manuelle d'une adresse ne dépend d'aucun
consentement.

La révocation efface la date (`consent_at = NULL`) : il ne reste pas de trace d'un
consentement retiré. À l'inverse, ré-enregistrer ses préférences ne réécrit **pas**
la date du consentement initial, qui fait foi.

### Le cas du visiteur sans compte (UF-802)

Depuis qu'UF-801 a ouvert le planificateur à tous, la moitié des personnes qui cliquent
sur « Me localiser » n'ont ni compte, ni ligne en base où poser une date. Les trois temps
ci-dessus restent identiques ; seul le **troisième** change de support : l'accord est
mémorisé dans le `localStorage` de l'appareil, et nulle part ailleurs.

Ce n'est pas un affaiblissement, c'est ce que la minimisation impose. Les deux autres
issues étaient pires :

| Option                                     | Pourquoi elle est écartée / retenue                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Exiger un compte pour se localiser         | Ré-enferme l'invité derrière l'inscription qu'UF-801 venait de retirer                |
| Créer un identifiant serveur pour l'invité | Collecter **plus** de données pour tracer un accord de ne rien collecter (art. 5-1-c) |
| **Mémoriser l'accord sur l'appareil**      | ✅ Retenue : la donnée reste chez la personne concernée                               |

Il n'y a d'ailleurs rien à opposer côté serveur : la position d'un invité sert au calcul
en cours et **n'est écrite nulle part** (`searchHistoryId: null` — aucune ligne
`search_history` n'est créée sans compte).

**Retrait** (art. 7-3, aussi simple que l'accord) : le bouton « Effacer ma position »
oublie l'accord mémorisé, en plus de la position affichée. Un invité n'a pas d'écran de
profil où aller le révoquer ; c'est donc ici que le retrait doit être possible. Pour un
compte, le même bouton n'efface que l'écran — la révocation reste au profil, annoncée
comme telle.

Le panneau de consentement dit ce qui est vrai dans chaque cas : promettre à un visiteur
une révocation « depuis votre profil » serait faux sur les deux points, et un
consentement décrivant mal ce qui se passe n'est pas éclairé.

Implémentation : [`use-user-location.ts`](../apps/web/features/planner/use-user-location.ts),
[`locate-me.tsx`](../apps/web/features/planner/locate-me.tsx),
[`geolocation-consent.ts`](../apps/web/lib/geolocation-consent.ts),
[`users.service.ts`](../apps/api/src/modules/users/users.service.ts).

---

## 3. Droit à l'effacement (art. 17)

`DELETE /api/users/me` — sans identifiant, sans corps. Le compte visé est celui du
JWT vérifié, et il n'existe **aucune forme de cette requête** capable d'en désigner
un autre.

L'effacement est **réel, pas logique** : pas de colonne `deleted_at`, pas de ligne
anonymisée gardée « au cas où ». Un compte marqué supprimé reste un compte — et
l'historique de déplacements est précisément la donnée que le recoupement rend
ré-identifiable (le domicile, c'est le point de départ récurrent du matin). La ligne
`users` part, et les cascades du schéma emportent `mobility_profiles` et
`search_history`.

La réponse porte le **décompte de ce qui a disparu** (`deletedSearchHistoryCount`,
`deletedMobilityProfile`) : un droit exercé sans preuve d'exécution n'est vérifiable
ni par l'utilisateur, ni en recette.

Côté interface, la suppression vit en bas de la page « Mon profil », derrière une
confirmation par saisie du mot `SUPPRIMER`. La boîte native `window.confirm` a été
écartée : ni stylable, ni traduisible, mal annoncée par un lecteur d'écran, et
refermée d'un `Entrée` réflexe — inadaptée à une action irréversible.

L'écran oriente d'abord vers le geste moins radical : beaucoup de suppressions de
compte ne visent en réalité qu'à couper la géolocalisation, que l'interrupteur du
profil suffit à retirer.

Vérification en base après suppression :

```sql
SELECT COUNT(*) FROM users          WHERE email = 'test@example.com';  -- 0
SELECT COUNT(*) FROM search_history WHERE user_id = '<uuid>';          -- 0
SELECT COUNT(*) FROM mobility_profiles WHERE user_id = '<uuid>';       -- 0
```

---

## 4. Limitation de la conservation

`SEARCH_HISTORY_RETENTION_DAYS = 365` vit dans
[`packages/shared/src/privacy.ts`](../packages/shared/src/privacy.ts) — **une seule
constante**, importée à la fois par la purge côté API et par la page publiée côté
PWA. Le délai annoncé à l'utilisateur ne peut donc pas diverger de celui qui
s'applique : deux constantes séparées auraient fini par mentir.

**Pourquoi 12 mois** : c'est la plus courte durée qui laisse un sens au bilan carbone
personnel, dont l'unité de lecture est le mois et la comparaison naturelle l'année
écoulée. En dessous, la fonctionnalité perd son objet ; au dessus, on conserverait
des trajets que plus personne ne consulte.

**Pourquoi une tâche planifiée** (`@Cron`, chaque nuit à 3 h) plutôt qu'une purge
déclenchée à l'écriture : ce sont les **comptes dormants** qui posent le problème.
Quelqu'un qui n'ouvre plus l'application ne déclenche plus aucune écriture, et ses
trajets resteraient indéfiniment. Une limitation de conservation qui ne s'appliquerait
qu'aux utilisateurs actifs n'en serait pas une.

Seuls les déplacements ont une échéance. Le compte et les préférences restent tant
que l'utilisateur les veut : ce sont des réglages, pas la trace d'un comportement.

Déclenchement manuel en recette (sans attendre 3 h du matin) :

```ts
// depuis un contexte Nest — ex. un script ts-node
await app.get(DataRetentionService).purgeExpiredSearchHistory();
```

---

## 5. Mesures de protection (art. 32)

| Mesure                                          | Ce qu'elle empêche concrètement                                                                | Où                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **HTTPS + HSTS** (6 mois, sous-domaines inclus) | Qu'une **première** requête parte en clair avant la redirection 301, cookie de session compris | `apps/api/src/main.ts`                                |
| **Cookie `httpOnly`**                           | Le vol du jeton de session par injection de script (XSS)                                       | `apps/api/src/common/auth-cookie.ts`                  |
| **`SameSite=lax`**                              | Qu'un site tiers déclenche une écriture authentifiée (CSRF)                                    | idem                                                  |
| **`secure` en production**                      | L'émission du cookie sur un canal non chiffré                                                  | idem                                                  |
| **Cloisonnement par le token**                  | La lecture des trajets d'autrui — aucune route n'accepte d'identifiant de compte               | `users.controller.ts`, `search-history.controller.ts` |
| **Hash argon2**                                 | La lecture des mots de passe en cas de fuite de la base                                        | `auth.service.ts`                                     |
| **Requêtes paramétrées**                        | L'injection SQL, y compris dans les requêtes PostGIS brutes                                    | `search-history.service.ts`                           |
| **Validation stricte des entrées**              | Toute clé non déclarée est rejetée en 400 (`forbidNonWhitelisted`)                             | `apps/api/src/main.ts`                                |
| **Journaux sans donnée personnelle**            | Que l'effacement d'un compte survive dans les logs                                             | `users.service.ts`, `global-exception.filter.ts`      |

Sur le dernier point : le journal d'audit de l'effacement consigne **l'événement**
— identifiant technique et compteurs — jamais l'e-mail ni les lieux. Une trace RGPD
qui recopierait les données qu'on vient d'effacer les ferait survivre, ce que
l'article 17 interdit précisément.

### Le cas `secure` en développement

`secure: process.env.NODE_ENV === 'production'`. Le développement local tourne en
HTTP : un `secure` inconditionnel rendrait la session inutilisable hors HTTPS et
pousserait à le désactiver au mauvais endroit. Le déploiement, lui, impose HTTPS de
bout en bout — c'est là que la mesure compte.

---

## 6. Ce qui reste ouvert

Écarts assumés du prototype, à mentionner en soutenance plutôt qu'à masquer :

- **Chiffrement au repos** : délégué à l'hébergeur (chiffrement disque). Aucun
  chiffrement applicatif colonne par colonne sur `search_history` — il empêcherait
  les requêtes spatiales (`ST_DWithin`) qui sont la raison d'être de PostGIS ici.
- **Export des données (art. 20, portabilité)** : non implémenté. La lecture est
  possible via `GET /api/users/me` et `GET /api/search-history`, mais aucun export
  d'un fichier téléchargeable n'est proposé.
- **Notification de violation (art. 33)** : sans objet sur un prototype non déployé,
  aucune procédure formalisée.
- **Révocation immédiate du JWT** : un jeton déjà émis reste valide jusqu'à son
  expiration (15 min). Après suppression de compte il ne désigne plus rien — toute
  route protégée répond 404 — mais la révocation stricte demanderait une liste de
  jetons révoqués, donc un état côté serveur.
- **Cookies tiers / traceurs** : aucun. Les polices sont self-hostées par
  `next/font`, il n'y a ni analytics, ni CDN externe — d'où l'absence de bandeau
  cookies, qui n'aurait rien à demander.

---

## 7. Recette du ticket

| Critère                                                               | Vérifié par                                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| La géolocalisation n'est activée qu'après consentement explicite      | `use-user-location.ts` + parcours manuel (§2)                                     |
| Une politique de confidentialité claire est accessible dans l'app     | `/confidentialite`, liée depuis le pied de page **et** le panneau de consentement |
| L'utilisateur peut supprimer son compte et ses données                | `users.controller.spec.ts` (effacement + cascade + isolation), requêtes SQL du §3 |
| Les données sensibles ne circulent qu'en HTTPS ; rétention documentée | HSTS dans `main.ts`, `data-retention.service.spec.ts`, ce document                |
