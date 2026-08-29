# Environnement de préproduction (UF-607)

Un environnement **distinct du développement**, qui fait tourner le code tel
qu'il serait livré : images construites, `NODE_ENV=production`, bundle Next
optimisé, journaux structurés, aucun rechargement à chaud.

C'est là qu'on rejoue un bogue signalé et qu'on valide un correctif avant de le
fondre dans `main` — voir [`docs/bug-process.md`](bug-process.md).

---

## 1. Pourquoi un environnement de plus

Le développement local ment, et il ment utilement : rechargement à chaud, code
non minifié, sources visibles, journaux lisibles, base remplie à la main. Ces
commodités masquent précisément la catégorie de défauts qui n'apparaît qu'en
production :

| Ce qui ne casse **qu'**en conditions de livraison                | Pourquoi le dev ne le voit pas                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| Une variable `NEXT_PUBLIC_*` absente du build                    | En dev, le client API retombe sur `localhost:3001` (UF-004) |
| Une CSP ou un HSTS trop stricts                                  | `upgradeInsecureRequests` et HSTS sont désactivés hors prod |
| Un cookie `Secure` que le navigateur refuse de renvoyer          | Les attributs changent avec `NODE_ENV`                      |
| Une migration Prisma jamais rejouée sur une base vierge          | La base de dev a été migrée pas à pas depuis des mois       |
| Une dépendance de développement utilisée par du code d'exécution | Elle est installée en dev, absente de l'image               |

La préproduction est l'endroit où ces cinq lignes se découvrent **avant** la
soutenance, et non pendant.

---

## 2. Ce qui le distingue du développement

|                  | Développement                               | **Préproduction**                                       |
| ---------------- | ------------------------------------------- | ------------------------------------------------------- |
| Lancement        | `npm run dev`                               | `make preprod-up` (images Docker)                       |
| PWA              | `localhost:3000`, rechargement à chaud      | **`localhost:3100`**, build de production               |
| API              | `localhost:3001`, `nest start --watch`      | **`localhost:3101`**, `node dist/main.js`               |
| Base             | `localhost:5433`, volume `urbanflow_pgdata` | **`localhost:5434`**, volume `urbanflow_pgdata_preprod` |
| `NODE_ENV`       | `development`                               | `production`                                            |
| `APP_ENV`        | _(absent)_                                  | `preproduction`                                         |
| Journaux         | Texte coloré NestJS                         | **JSON structuré**, une ligne par événement             |
| Secret JWT       | `JWT_SECRET` (dev)                          | **`PREPROD_JWT_SECRET`**, distinct                      |
| Mot de passe BDD | `POSTGRES_PASSWORD`                         | **`PREPROD_POSTGRES_PASSWORD`**, distinct               |

> **`NODE_ENV=production` ET `APP_ENV=preproduction`** : les deux, et pas un
> seul. Le premier commande le **comportement** — la préproduction doit
> exécuter exactement le code de la production, sinon elle ne prouve rien. Le
> second ne sert qu'à **étiqueter les journaux** : sans lui, un incident de
> préproduction se confondrait avec un incident réel. Aucun chemin de code ne
> dépend d'`APP_ENV`, par construction (voir `config/env.validation.ts`).

### L'écart assumé : OpenTripPlanner est partagé

Le service `otp` du compose de développement est **réutilisé** par la
préproduction. Son graphe pèse plusieurs gigaoctets et met de longues minutes à
se construire ; en dupliquer un second coûterait cher (C5) sans rien prouver de
plus — OTP est une dépendance externe, pas notre code. C'est le seul écart :
base de données, secrets, images et ports sont bien distincts.

Conséquence pratique : sans `make otp-up`, la préproduction fonctionne, mais le
planificateur rend une liste vide avec `sources.transit.available = false`.
C'est le comportement de dégradation gracieuse attendu (C10) — pas une panne.

---

## 3. Mise en route

### 3.1 Configuration (une fois)

Ajouter au `.env` **racine** (jamais commité) les deux variables obligatoires,
avec des valeurs **différentes** de celles du développement :

```dotenv
PREPROD_POSTGRES_PASSWORD=…              # autre mot de passe que POSTGRES_PASSWORD
PREPROD_JWT_SECRET=…                     # 32 caractères minimum, autre secret que JWT_SECRET
```

Générer un secret : `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

Le compose **refuse de démarrer** si l'une des deux manque : une préproduction
qui hérite des secrets du développement n'est pas un environnement séparé (C4).
Les autres variables ont des valeurs par défaut, rappelées dans `.env.example`.

### 3.2 Démarrage

```bash
make preprod-up          # construit les images puis démarre les trois services
make preprod-migrate     # applique les migrations Prisma sur la base de préprod
make preprod-health      # {"status":"ok","db":true,…}
```

Puis ouvrir **<http://localhost:3100>**.

Le premier build prend quelques minutes (installation + compilation des deux
applications) ; les suivants réutilisent le cache des couches Docker tant que
les dépendances ne bougent pas.

### 3.3 Commandes courantes

| Commande                | Effet                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `make preprod-up`       | Construit et démarre (web 3100, api 3101, db 5434)             |
| `make preprod-build`    | Reconstruit les images sans démarrer                           |
| `make preprod-ps`       | État des trois conteneurs                                      |
| `make preprod-logs`     | Journaux des trois services                                    |
| `make preprod-logs-api` | Journaux JSON de l'API seule                                   |
| `make preprod-migrate`  | Applique les migrations sur la base de préproduction           |
| `make preprod-health`   | Sonde `/api/health` (API + connectivité base)                  |
| `make preprod-down`     | Arrête et supprime les conteneurs (**le volume est conservé**) |
| `make preprod-reset`    | Détruit la base (volume inclus) et repart d'une base vierge    |

---

## 4. Les images

| Image                   | Fichier               | Contenu de l'étape finale                               |
| ----------------------- | --------------------- | ------------------------------------------------------- |
| `urbanflow-api:preprod` | `apps/api/Dockerfile` | `dist/` + dépendances de production (dev deps élaguées) |
| `urbanflow-web:preprod` | `apps/web/Dockerfile` | Sortie `standalone` de Next.js + fichiers statiques     |

Deux étapes dans chaque fichier : on compile avec l'outillage complet, on
n'expédie que le résultat. Ni sources TypeScript, ni compilateur, ni CLI dans
l'image finale — moins d'octets (C5) et moins de surface (C4). Les deux
conteneurs tournent sous l'utilisateur non privilégié `node`.

> ⚠️ **`NEXT_PUBLIC_API_URL` est une variable de BUILD.** Next.js l'inline dans
> le bundle envoyé au navigateur : la changer sur un conteneur déjà construit
> n'a aucun effet. Changer le port de l'API impose de **reconstruire** l'image
> web (`make preprod-build`).

---

## 5. Lire les journaux

Une ligne = un objet JSON. Les champs utiles au diagnostic :

```json
{
  "ts": "2026-08-29T20:27:19.709Z",
  "level": "warn",
  "msg": "POST /api/routes/plan -> 401",
  "service": "urbanflow-api",
  "env": "preproduction",
  "context": "GlobalExceptionFilter",
  "requestId": "smoke-test-42"
}
```

```bash
make preprod-logs-api | grep '"level":"error"'                    # les erreurs seules
make preprod-logs-api | grep '"requestId":"<référence>"'          # une requête, de bout en bout
make preprod-logs-api | grep '"context":"ClientError"'            # les pannes d'affichage signalées par la PWA
```

`stdout` porte les niveaux `log`/`warn`, `stderr` les `error`/`fatal` :
`docker compose logs` les mêle, un orchestrateur les sépare sans configuration.

---

## 6. Ce que cet environnement n'est pas

Ce n'est **pas** une production, et il ne prétend pas l'être :

- un seul nœud, aucune réplication, aucune sauvegarde ;
- pas de terminaison TLS (HSTS est envoyé, mais l'accès local reste en HTTP) ;
- limitation de débit en mémoire du processus — donc remise à zéro à chaque
  redémarrage (voir `docs/securite-owasp.md`) ;
- jeu de données réduit, alimenté à la main ou par les migrations.

Sa promesse est plus étroite, et suffisante : **le code y est celui qui serait
livré**, et un bogue reproduit ici est un bogue reproduit dans les conditions de
la livraison.
