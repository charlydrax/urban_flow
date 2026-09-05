# Sécurité OWASP — audit et durcissement (UF-604)

Revue systématique d'UrbanFlow au regard de l'**OWASP Top 10 (2021)**, avec pour chaque
point le **statut**, ce qui le couvre **dans le code**, et ce qui reste ouvert.

Contrainte principale : **C4** (sécurité OWASP). Contraintes voisines mobilisées :
**C11** (sécurité des données de déplacement), **C8** (RGPD), **C5/C10** (les plafonds de
requêtes servent aussi la sobriété et la disponibilité).

Code de référence :
[`apps/api/src/common/throttling.ts`](../apps/api/src/common/throttling.ts) (limitation de débit),
[`apps/api/src/main.ts`](../apps/api/src/main.ts) (en-têtes HTTP, CSP, CORS, ValidationPipe),
[`apps/web/lib/security-headers.ts`](../apps/web/lib/security-headers.ts) (CSP et en-têtes du front),
[`apps/web/middleware.ts`](../apps/web/middleware.ts) (CSP par requête, nonce),
[`apps/api/src/common/guards/jwt-auth.guard.ts`](../apps/api/src/common/guards/jwt-auth.guard.ts) (authentification par défaut),
[`apps/api/src/common/auth-cookie.ts`](../apps/api/src/common/auth-cookie.ts) (cookie de session).

Document frère côté données personnelles : [`docs/rgpd.md`](./rgpd.md).

---

## 1. Checklist OWASP Top 10 (2021)

| #       | Risque                           | Statut     | Ce qui le couvre                                                                                                                                                                                                         | Reste à faire                                            |
| ------- | -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **A01** | Broken Access Control            | ✅ Couvert | Guard JWT **global** (privé par défaut, `@Public()` en opt-out) ; identité prise du token seul ; chaque requête de données filtre sur `user_id` ; autorisation par rôle relue **en base**, jamais dans le jeton (UF-701) | —                                                        |
| **A02** | Cryptographic Failures           | ✅ Couvert | argon2id pour les mots de passe ; JWT signé HS256, secret ≥ 32 car. validé au boot ; cookie `httpOnly` + `secure` en prod ; HSTS 6 mois                                                                                  | Rotation du secret JWT à formaliser au déploiement       |
| **A03** | Injection                        | ✅ Couvert | Prisma paramétré ; SQL brut uniquement en _tagged template_ (`$queryRaw`), **aucun** `queryRawUnsafe` ; CSP anti-XSS avec nonce côté front                                                                               | —                                                        |
| **A04** | Insecure Design                  | ✅ Couvert | Plafonds de requêtes par IP (voir §3) ; dégradation gracieuse des sources ; pas de `userId` accepté dans un corps de requête                                                                                             | —                                                        |
| **A05** | Security Misconfiguration        | ✅ Couvert | helmet avec CSP/HSTS/`frame-ancestors` explicites ; CORS sur une origine unique ; env validée au démarrage (fail-fast) ; `X-Powered-By` retiré                                                                           | —                                                        |
| **A06** | Vulnerable & Outdated Components | ⚠️ Partiel | `npm audit` : **17 → 6** vulnérabilités, **0 critique** (voir §4)                                                                                                                                                        | 4 résiduelles dev/build, levées par la montée en Next 16 |
| **A07** | Identification & Auth Failures   | ✅ Couvert | 5 tentatives/min sur `login` et `register` ; 401 générique ; vérification argon2 factice à temps constant ; expiration de token appliquée                                                                                | MFA hors périmètre MVP                                   |
| **A08** | Software & Data Integrity        | ✅ Couvert | Lockfile committé, CI sur `npm ci` ; aucun script distant chargé (`script-src 'self' 'nonce-…'`) ; pas de CDN                                                                                                            | Signature des artefacts au déploiement                   |
| **A09** | Logging & Monitoring Failures    | ⚠️ Partiel | Filtre d'exceptions global : logs `méthode/chemin/statut`, jamais de corps ni de coordonnées (C11) ; `/api/health`                                                                                                       | Pas d'alerte sur rafale de 429 (mono-instance, hors MVP) |
| **A10** | Server-Side Request Forgery      | ✅ Couvert | Aucune URL fournie par l'utilisateur n'est appelée : OTP, GBFS et BAN sont des origines **fixes**, lues dans l'environnement                                                                                             | —                                                        |

---

## 2. En-têtes de sécurité HTTP (recette 1)

### API Gateway (`apps/api/src/main.ts`)

| En-tête                        | Valeur                                          | Ce qu'il empêche                                                             |
| ------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `Content-Security-Policy`      | `default-src 'self'` + `frame-ancestors 'none'` | Toute exécution de script sur une réponse de l'API ; l'encadrement en iframe |
| `Strict-Transport-Security`    | `max-age=15552000; includeSubDomains`           | Le premier aller-retour en clair, avant même la redirection HTTPS            |
| `X-Content-Type-Options`       | `nosniff`                                       | La ré-interprétation d'une réponse JSON comme du script                      |
| `Referrer-Policy`              | `no-referrer`                                   | La fuite d'URL de ressources vers un site tiers                              |
| `Cross-Origin-Resource-Policy` | `same-origin`                                   | La lecture de nos réponses par une page tierce                               |

L'API ne sert que du JSON : une CSP « tout interdit sauf soi-même » n'y coûte rien.
**Une seule exception, limitée au chemin `/api/docs`** : Swagger UI s'initialise par un
script inline et resterait une page blanche sous la politique stricte. L'assouplissement
(`'unsafe-inline'` sur `script-src` et `style-src`, aucune origine externe) est posé par
un middleware monté sur ce seul chemin, après le helmet global — plutôt que d'affaiblir
la politique de toute l'API pour une page d'outillage.

### Client PWA

Les en-têtes constants viennent de `next.config.ts` (donc sur **toutes** les réponses, y
compris les fichiers statiques) ; la CSP vient du middleware, parce qu'elle porte un
**nonce régénéré à chaque requête**.

| En-tête                   | Valeur                                                             | Ce qu'il empêche                                                          |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `Content-Security-Policy` | `script-src 'self' 'nonce-…'`, `frame-ancestors 'none'`, …         | L'exécution d'un script injecté ; le clickjacking ; l'exfiltration réseau |
| `X-Content-Type-Options`  | `nosniff`                                                          | La déduction de type MIME                                                 |
| `X-Frame-Options`         | `DENY`                                                             | Le clickjacking sur les navigateurs sans CSP niveau 2                     |
| `Referrer-Policy`         | `strict-origin-when-cross-origin`                                  | La fuite d'une adresse de départ présente dans l'URL (C8)                 |
| `Permissions-Policy`      | `geolocation=(self), camera=(), microphone=(), payment=(), usb=()` | Qu'une iframe tierce emprunte la permission de géolocalisation (C6/C8)    |

`connect-src` vaut **inventaire des appels sortants du navigateur** : notre API, la Base
Adresse Nationale (géocodage), les deux fournisseurs de tuiles. Aucun traceur tiers ne
pourrait exfiltrer une adresse de départ sans apparaître dans cette liste.

Deux assouplissements assumés, tous deux testés dans `lib/security-headers.test.ts` :

- `style-src 'unsafe-inline'` — React et MapLibre posent des styles inline sur les
  éléments qu'ils animent. Injecter du CSS ne permet pas d'exécuter du code.
- `script-src 'unsafe-eval'` **en développement seulement** — le rechargement à chaud de
  Next.js compile en `eval`. Le desserrage ne quitte jamais la machine de dev.

HSTS est volontairement **absent en développement** : servi sur `http://localhost:3000`,
il condamnerait le domaine dans le navigateur du développeur pour six mois.

---

## 3. Limitation de débit (recette 2)

Configuration et justification des seuils : [`common/throttling.ts`](../apps/api/src/common/throttling.ts).

| Périmètre                            | Plafond     | Pourquoi ce seuil                                                                                               |
| ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------- |
| Tous les endpoints                   | 120 req/min | Très au-dessus d'un usage humain, assez bas pour couper un moissonnage ou une boucle de retry emballée          |
| `POST /auth/login`, `/auth/register` | 5 req/min   | Un dictionnaire passe de milliers d'essais/minute à cinq ; cinq fautes de frappe en une minute n'arrivent pas   |
| `POST /routes/plan`                  | 60 req/min  | Chaque appel relaie **trois** requêtes sortantes : le plafond protège aussi les quotas de nos fournisseurs (C5) |

### Le plafond du planificateur est passé de 20 à 60 (UF-802)

Le seuil de 20 datait de l'époque où `/routes/plan` exigeait un compte : derrière une IP,
il y avait **une** personne connectée. UF-801 a ouvert l'endpoint aux visiteurs, ce qui
change la nature du compteur sans changer sa valeur — une IP publique n'est plus une
personne, c'est un **point de sortie partagé** : wifi d'établissement, réseau
d'entreprise, et surtout CGNAT des opérateurs mobiles, où des milliers d'abonnés sortent
derrière la même IPv4. Vingt calculs par minute à se partager, c'était le premier arrivé
qui consommait le quota des autres.

Une recherche = **un** appel (le tri, le filtre PMR et l'ouverture du détail ne rappellent
rien). Soixante laissent donc coexister une dizaine d'usagers simultanés derrière la même
sortie, tout en bornant l'amplification à 180 requêtes sortantes/minute et par IP. Le
seuil reste sous le plafond global de 120 : le planificateur ne devient pas le chemin le
plus permissif de l'API.

### La clé de comptage regroupe l'IPv6 au /64 (UF-802)

`@nestjs/throttler` compte `req.ip` tel quel. En IPv4, une adresse ≈ un point de sortie :
c'est la bonne maille. En IPv6, **non** — le moindre abonné se voit déléguer un bloc /64
(18 milliards de milliards d'adresses) et en change gratuitement à chaque requête
(RFC 4941). Compté à l'adresse près, un client IPv6 se donnait donc un compteur neuf à
volonté : le plafond de l'endpoint public le plus coûteux du système était contournable
sans rien à prouver (OWASP A04 « Insecure Design »).

`IpThrottlerGuard` (`common/guards/ip-throttler.guard.ts`) redéfinit la clé via la
fonction pure `throttleTracker` :

| Adresse de la requête | Clé du compteur     |
| --------------------- | ------------------- |
| `203.0.113.7`         | `203.0.113.7`       |
| `::ffff:203.0.113.7`  | `203.0.113.7`       |
| `2001:db8:1:2:a::9`   | `2001:db8:1:2::/64` |

Le /64 est le plus petit bloc qui corresponde à **un** abonné : le regroupement ne
mutualise rien qui n'appartienne déjà à la même personne. Une adresse illisible est
comptée entière plutôt que versée dans un compartiment commun ; une requête sans IP
lisible tombe dans une clé unique — en cas de doute, on plafonne plus fort, on n'ouvre
pas une voie sans compteur.

Deux choix de conception à assumer en soutenance :

**Le compteur est indexé sur l'IP, pas sur le compte.** C'est la seule identité qu'une
requête anonyme possède, et depuis UF-801 la majorité des appels au planificateur n'en ont
pas d'autre : compter par utilisateur laisserait l'accès invité entièrement hors compteur,
c'est-à-dire sans plafond. C'est aussi ce qui permet au guard de débit de rester **avant**
le guard JWT — une rafale est coupée sans payer la moindre vérification de signature.

**Sur le login, le compteur est indexé sur l'IP, pas sur l'e-mail visé.** Compter par e-mail ouvrirait
un déni de service ciblé : n'importe qui bloquerait le compte d'un tiers en enchaînant
des tentatives sur son adresse. Le prix à payer, c'est qu'une attaque distribuée sur un
large parc d'IP passe sous le radar — l'argon2 du `AuthService` reste la seconde ligne.

**Aucun compte n'est verrouillé.** La fenêtre expire d'elle-même au bout d'une minute ;
il n'y a donc pas d'état de blocage à administrer, ni de nouvelle surface d'abus.

Le guard de débit est déclaré **avant** le guard JWT : une rafale anonyme est coupée sans
payer la vérification de signature ni la moindre requête en base.

**Limites connues :**

- Le compteur vit **en mémoire du processus**. En plusieurs répliques, chacune compte de
  son côté et le plafond effectif est multiplié par leur nombre. Passer au stockage Redis
  (`@nest-lab/throttler-storage-redis`) le jour où l'API est répliquée.
- Derrière un reverse proxy, il faut positionner `TRUST_PROXY=1` (voir `apps/api/.env.example`),
  sinon toutes les requêtes portent l'IP du proxy et partagent **un seul** compteur. Et
  surtout pas l'inverse : en exposition directe, faire confiance à `X-Forwarded-For`
  rendrait le plafond contournable par un simple en-tête forgé.

---

## 4. Audit des dépendances (recette 3)

Passe du 29/08/2026, `npm audit` à la racine du monorepo (1 262 paquets).

| Avant                                                               | Après                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **17** vulnérabilités — 2 critiques, 12 hautes, 1 modérée, 2 basses | **6** vulnérabilités — **0 critique**, 4 hautes, 1 modérée, 1 basse |

`npm audit fix` (sans `--force`) a corrigé 11 vulnérabilités sans changement de version
majeure, dont les deux critiques (`shell-quote`, via `concurrently`).

### Résiduelles, et pourquoi elles sont acceptées

| Paquet                            | Sévérité | Chemin                            | Analyse d'exploitabilité                                                                                                                                            |
| --------------------------------- | -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postcss` ≤ 8.5.22                | Haute    | `next` → `postcss`                | Lecture de fichier via `sourceMappingURL` **à la compilation**, sur du CSS que nous écrivons. Non atteignable à l'exécution. La correction impose Next 16 (majeure) |
| `deepmerge-ts` < 8                | Haute    | `prisma` (CLI) → `@prisma/config` | Épuisement de pile en fusionnant un graphe récursif — dans un **outil de développement**, sur notre propre fichier de config                                        |
| `esbuild` 0.27.3–0.28.0           | Basse    | `vite` (Vitest)                   | Lecture de fichier via le **serveur de développement** de Vite, jamais démarré en production                                                                        |
| `next` (DoS Server Actions, SSRF) | Modérée  | direct                            | Le projet n'utilise **aucune** Server Action ni `rewrites` ; correction dans la même montée en Next 16                                                              |

Les trois premières sont hors du bundle de production : elles concernent la chaîne de
build et l'outillage local, pas le code servi aux utilisateurs.

> ⚠️ Tentative documentée : forcer les versions saines par un bloc `overrides` dans le
> `package.json` racine **ne fonctionne pas** avec npm 10.9.3 — l'override est bien
> enregistré (`npm ls` affiche « overridden ») mais l'arbre installé garde l'ancienne
> version, y compris après régénération du lockfile. Le bloc a donc été retiré plutôt que
> laissé en place : un `overrides` inopérant donne à un relecteur l'illusion d'un
> correctif. **Action tracée : ticket de montée en Next 16**, à traiter pour lui-même,
> pas en cavalier d'un ticket de sécurité.

---

## 5. Validation des entrées

`ValidationPipe` global avec `whitelist: true` **et** `forbidNonWhitelisted: true`
(`main.ts`) : toute propriété non déclarée dans un DTO fait échouer la requête en 400,
au lieu d'être silencieusement ignorée. C'est ce second drapeau qui compte — sans lui, un
client pourrait poster des champs parasites sans jamais être détrompé.

Vérification faite endpoint par endpoint : chaque `@Body()` et chaque `@Query()` de l'API
est typé par un DTO annoté `class-validator` (`modules/*/dto/`). Les variables
d'environnement suivent la même règle, validées au démarrage — l'API refuse de démarrer
plutôt que de tourner à moitié configurée.

---

## 6. Secrets

- `.gitignore` exclut `.env` et `.env.*`, sauf `.env.example`. Vérification : les seuls
  fichiers d'environnement suivis par git sont les trois `.env.example`.
- Côté client, **seules** les variables `NEXT_PUBLIC_*` sont inlinées au build, et aucune
  n'est un secret : `NEXT_PUBLIC_API_URL` est une adresse publique ; `NEXT_PUBLIC_MAPTILER_KEY`
  est une clé de tuiles qui, par nature, part dans le navigateur — sa protection réelle
  est la **restriction par domaine** dans le tableau de bord MapTiler, pas la discrétion.
- `JWT_SECRET` : longueur minimale de 32 caractères imposée par la validation d'environnement,
  aucune valeur par défaut en dur.

---

## 7. Cloisonnement des comptes

Chaque lecture ou écriture de données personnelles filtre sur l'identifiant issu du
**JWT vérifié**, jamais d'un paramètre client :

| Ressource                 | Filtre                                    |
| ------------------------- | ----------------------------------------- |
| Profil de mobilité        | `WHERE user_id = <sub du JWT>`            |
| Historique de recherches  | `WHERE user_id = <sub du JWT>`            |
| Sélection d'un itinéraire | `WHERE id = … AND user_id = <sub du JWT>` |
| Bilan carbone             | agrégat borné au même `user_id`           |

Le contrat de `POST /routes/plan` n'accepte **plus** de `userId` dans le corps depuis
UF-402 (écart assumé au diagramme de séquence, documenté dans `CLAUDE.md` §4) : accepter
un identifiant de compte depuis une requête est un défaut de conception même quand le
serveur l'ignore.

### Autorisation par rôle (UF-701)

Le cloisonnement ci-dessus répond à « chacun ne voit que ses données ». UF-701
ajoute la question voisine : « qui a le droit d'utiliser cette fonction ? ».

| Étape            | Guard          | Question          | Refus |
| ---------------- | -------------- | ----------------- | ----- |
| Authentification | `JwtAuthGuard` | qui est-ce ?      | `401` |
| Autorisation     | `RolesGuard`   | a-t-il le droit ? | `403` |

Un seul endpoint est aujourd'hui réservé : `POST /api/simulation/trip`, l'outil
de démonstration qui rejoue un trajet sur une position fictive. Il est réservé
parce que simuler un déplacement, c'est le faire **compter** dans le suivi
carbone (UF-807) : ouvrir cette porte à tout le monde reviendrait à laisser
chacun se composer un bilan, exactement ce qu'UF-505 refuse en n'acceptant
aucun gramme venu du navigateur.

Trois points de conception, et ce sont ceux qui rendent la mesure défendable :

1. **La décision se prend en base, pas dans le jeton.** Le JWT porte bien une
   revendication `role`, mais elle ne sert qu'à l'interface (peindre ou non le
   bouton « Simuler le déplacement »). Le guard relit le rôle à chaque appel :
   un jeton vit quinze minutes, et un droit accordé sur une revendication de
   quinze minutes est un droit qu'on ne peut pas révoquer. Le test
   `apps/api/src/common/guards/roles.guard.spec.ts` fige le cas décisif — un
   jeton qui revendique `admin` alors que la base dit `user` reçoit un `403`.
2. **Le repli est toujours le moins-disant.** Jeton sans `role`, rôle inconnu,
   compte supprimé entre-temps (droit à l'effacement — C8) : tout se traduit
   par un refus, jamais par un privilège.
3. **`403` et non `401`.** Le compte est authentifié ; le renvoyer vers l'écran
   de connexion l'enverrait chercher une solution là où il n'y en a pas.

Le rôle ne s'obtient pas par l'inscription : `RegisterDto` n'a pas de champ, et
le `ValidationPipe` global (`forbidNonWhitelisted`) refuse en `400` une requête
qui en enverrait un. Un compte `admin` se crée par le seed, à partir de
`DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` — jamais d'identifiants en dur dans
le dépôt, et le seed ne journalise que l'email et le rôle (C11).

---

## 8. Recette du ticket UF-604

- [x] **Les en-têtes de sécurité sont présents** (vérifiables dans la réponse HTTP) —
      §2 ; vérifié sur l'API (`curl -D -`) et sur le front (onglet Réseau).
- [x] **Le login est protégé contre le brute-force** — §3 ; prouvé automatiquement par
      `apps/api/src/common/throttling.spec.ts` (7 tests, contrôleurs réels, 429 à la 6ᵉ tentative).
- [x] **`npm audit` ne remonte pas de vulnérabilité critique non traitée** — §4 ;
      0 critique, 6 résiduelles analysées et tracées.
- [x] **Une checklist OWASP Top 10 est renseignée** — §1.

### Tests automatisés ajoutés

| Fichier                                  | Ce qu'il prouve                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/common/throttling.spec.ts` | 429 effectif sur `login`, `register`, `plan` ; compteurs séparés ; le service n'est pas appelé au-delà du plafond |
| `apps/web/lib/security-headers.test.ts`  | Chaque directive CSP et chaque en-tête constant, un test par attaque nommée                                       |
| `apps/web/middleware.test.ts`            | La CSP est posée sur **tous** les chemins de sortie, nonce neuf à chaque requête                                  |
