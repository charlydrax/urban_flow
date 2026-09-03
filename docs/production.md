# Production — UrbanFlow Mobility

Mise en ligne, mise à jour, retour arrière et sauvegarde de l'environnement de
production (`https://urbanflow-lyon.com`).

> **Ce document existe à cause de BUG-002 ([#106](https://github.com/charlydrax/urban_flow/issues/106)).**
> La production avait été assemblée à la main sur le serveur, sans que rien n'en
> soit versionné. Cinq variables d'environnement obligatoires ont été oubliées,
> l'API a refusé de démarrer, et le site est resté en ligne — façade intacte,
> inscription impossible — sans que rien ne le signale. Ce fichier et
> `docker-compose.prod.yml` sont la réponse : la production se décrit dans le
> dépôt, ou elle se répare à l'aveugle.

---

## 1. Ce qui tourne, et où

| Service | Image                            | Exposé   | Rôle                               |
| ------- | -------------------------------- | -------- | ---------------------------------- |
| `caddy` | `caddy:2`                        | 80 / 443 | TLS (Let's Encrypt), routage       |
| `web`   | `charlydrax/urbanflow-web:<tag>` | non      | PWA Next.js (sortie autonome)      |
| `api`   | `charlydrax/urbanflow-api:<tag>` | non      | API Gateway NestJS                 |
| `db`    | `postgis/postgis:16-3.4`         | non      | PostgreSQL + PostGIS, volume nommé |

**Un seul service est joignable depuis l'internet.** L'API, la PWA et la base
ne publient aucun port sur l'hôte : tout passe par Caddy (C4/C11). C'est
vérifiable de l'extérieur — `curl http://urbanflow-lyon.com:3001` doit expirer,
jamais répondre.

Routage (`docker/caddy/Caddyfile`) :

```
/api/docs*  ->  404          (Swagger fermé en production)
/api, /api/*  ->  api:3001   (préfixe conservé : Nest le déclare lui-même)
tout le reste ->  web:3000
```

### Arborescence sur le serveur

```
/home/debian/urbanflow/
├── docker-compose.prod.yml      <- copié depuis le dépôt
├── .env.prod                    <- secrets, chmod 600, JAMAIS versionné
└── docker/
    ├── caddy/Caddyfile          <- copié depuis le dépôt
    └── initdb/01-init-postgis.sql
```

Les trois fichiers versionnés sont **copiés depuis le dépôt**, jamais édités
sur place : une modification faite directement sur le serveur est une
modification que personne ne relira.

---

## 2. Première mise en ligne

```bash
# 1. Déposer les fichiers versionnés
scp docker-compose.prod.yml    root@<serveur>:/home/debian/urbanflow/
scp docker/caddy/Caddyfile     root@<serveur>:/home/debian/urbanflow/docker/caddy/
scp docker/initdb/*.sql        root@<serveur>:/home/debian/urbanflow/docker/initdb/

# 2. Créer les secrets (une seule fois)
cp .env.production.example .env.prod
chmod 600 .env.prod
$EDITOR .env.prod        # DOMAIN, ACME_EMAIL, POSTGRES_PASSWORD, JWT_SECRET

# 3. Démarrer
cd /home/debian/urbanflow
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# 4. Appliquer le schéma
make prod-migrate        # ou la commande complète, section 4

# 5. Vérifier
curl -fsS https://<domaine>/api/health
```

### La vérification qui compte

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

La colonne `STATUS` doit afficher **`Up (healthy)`** pour `api` et `web`. Un
`Up` seul, ou pire un `Restarting`, veut dire que le conteneur vit mais que la
pile ne répond pas — c'est exactement l'état dans lequel BUG-002 a laissé la
production pendant une soirée. La sonde de santé de l'API interroge
`/api/health`, qui rapporte aussi l'état de la base : elle distingue « le
processus tourne » de « le service fonctionne ».

---

## 3. Les variables d'environnement, et pourquoi elles sont toutes obligatoires

`apps/api/src/config/env.validation.ts` valide la configuration **au
démarrage** et refuse de démarrer si quoi que ce soit manque ou sort des
bornes (fail-fast — C4). Le message nomme chaque variable fautive sans jamais
journaliser sa valeur (C11) :

```
Invalid environment configuration - the API refuses to start (fail-fast, C4).
  - OTP_BASE_URL: must be a URL address
  - OTP_TIMEOUT_MS: must not be greater than 30000, must not be less than 1000, …
```

> **Lire ce message en priorité.** Bornes haute _et_ basse violées ensemble =
> valeur `undefined`, donc variable **absente**, pas mal réglée. C'est la
> signature exacte de BUG-002, et elle se lit en trois secondes.

Les dix variables de l'API sont décrites dans
[`.env.production.example`](../.env.production.example). Le piège à connaître :
**`OTP_*` et `GBFS_*` sont exigées même quand le mode qu'elles configurent
n'est pas déployé.** C'est le prix — assumé — d'une configuration sans valeur
implicite.

`docker-compose.prod.yml` leur donne des valeurs par défaut sensées, de sorte
qu'un `.env.prod` réduit aux quatre secrets suffit à démarrer. Les secrets,
eux, n'ont **aucun défaut** : le compose refuse de se rendre (`:?`) plutôt que
de démarrer une production sur un mot de passe deviné.

### `TRUST_PROXY=1` — la ligne à ne pas retirer

Derrière Caddy, sans elle, Express voit l'IP du proxy sur chaque requête. Tous
les visiteurs partagent alors **un seul compteur de débit** : 120 requêtes par
minute pour le site entier, et surtout **5 inscriptions ou connexions par
minute, tous utilisateurs confondus** (`common/throttling.ts`). Le premier venu
épuise le quota de tous les autres, et l'inscription redevient impossible — en
`429` cette fois. Symptôme différent, panne identique.

Elle vaut `1`, pas davantage : un seul proxy est en place. En annoncer deux
laisserait un client forger `X-Forwarded-For` et se rendre anonyme (UF-604).

---

## 4. Migrations de la base

**`migrate deploy`, jamais `migrate dev`.** `migrate dev` peut proposer de
réinitialiser la base : sur une production, la question ne se pose pas.

Le client Prisma est embarqué dans l'image, mais **la CLI `prisma` est une
dépendance de développement** — `npm prune --omit=dev` la retire de l'image de
production. Les migrations sont donc jouées par une CLI récupérée à la volée,
sur le schéma embarqué dans l'image :

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec api npx --yes prisma@6 migrate deploy --schema apps/api/prisma/schema.prisma
```

Vérifier ce qui est réellement appliqué :

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec db psql -U urbanflow -d urbanflow \
  -c 'SELECT migration_name FROM _prisma_migrations ORDER BY started_at;'
```

> **À contrôler à chaque mise en ligne.** Le 03/09/2026, la production ne
> comptait **qu'une migration sur sept** : `cycle_paths` et
> `trip_mode_footprints` n'existaient pas, et le planificateur comme le suivi
> carbone seraient tombés en `500` dès l'API redémarrée. Une image à jour sur
> une base en retard est une panne qui attend son premier utilisateur.

### Pistes cyclables

La migration `uf304` crée `cycle_paths` **vide**. Sans import, la recherche de
pistes ne rend jamais rien — silencieusement, puisque `ST_DWithin` sur une
table vide est une réponse parfaitement valide. Voir
[`cycle-paths-postgis.md`](cycle-paths-postgis.md).

---

## 5. Mettre à jour

Les images sont publiées, pas bâties sur le serveur : un VPS n'a pas à
compiler pour servir.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
make prod-migrate      # si la version apporte des migrations
```

> ⚠️ **`NEXT_PUBLIC_API_URL` est figée dans le bundle au build de l'image web.**
> Elle vaut `https://<domaine>/api`. Changer de domaine impose de reconstruire
> et republier l'image — aucune variable d'environnement ne rattrapera ça au
> démarrage.

### Retour arrière

`IMAGE_TAG` épingle la version déployée :

```bash
IMAGE_TAG=<version-precedente> docker compose -f docker-compose.prod.yml \
  --env-file .env.prod up -d
```

`latest` suit la dernière publication, ce qui est commode et **ne permet aucun
retour arrière** : publier des images étiquetées (`v0.1.0`, ou le SHA du
commit) est la condition pour que cette commande serve à quelque chose.

---

## 6. Sauvegarde de la base

Les données de déplacement sont des données personnelles (C8/C11) : la
sauvegarde se chiffre et ne quitte pas un stockage maîtrisé.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T db pg_dump -U urbanflow urbanflow | gzip > urbanflow-$(date +%F).sql.gz
```

Restauration sur une base vide :

```bash
gunzip -c urbanflow-<date>.sql.gz | docker compose -f docker-compose.prod.yml \
  --env-file .env.prod exec -T db psql -U urbanflow -d urbanflow
```

---

## 7. Diagnostiquer une panne

```bash
make prod-ps            # STATUS : (healthy) ? Restarting ?
make prod-logs-api      # journaux JSON — la cause du refus de démarrer est ici
make prod-health        # la pile répond-elle vraiment ?
```

| Symptôme                        | Piste la plus probable                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `502` sur tout `/api/*`         | API en boucle de redémarrage → `make prod-logs-api` (BUG-002)                                             |
| `502` immédiat (< 50 ms)        | Amont refusé : conteneur arrêté, ou mauvais port dans le `Caddyfile`                                      |
| `502` après ~3 s, constant      | Amont injoignable : le paquet part et personne ne répond (mauvais nom de service, réseaux Docker séparés) |
| `500` sur un endpoint précis    | Migration manquante → section 4                                                                           |
| `429` dès quelques inscriptions | `TRUST_PROXY` absent → section 3                                                                          |
| Toutes les requêtes en `404`    | `handle` du `Caddyfile` dans le mauvais ordre (elles s'excluent mutuellement, dans l'ordre écrit)         |

Chaque réponse d'erreur porte un `X-Request-Id`, présent aussi dans le corps et
dans chaque ligne de journal :

```bash
make prod-logs-api | grep '"requestId":"<référence>"'
```

Voir [`bug-process.md`](bug-process.md).

---

## 8. Écarts assumés, à ce jour

| Écart                                    | Conséquence                                                                                                                                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenTripPlanner non déployé**          | Pas de transports en commun en production. Le planificateur dégrade gracieusement (C10) et ne rend que marche, vélo et trottinette — soit la moitié de F2/F3. Le serveur a la mémoire nécessaire (11 Go) : c'est un déploiement à faire, pas une impossibilité. |
| **Nœud unique, sans redondance**         | Toute maintenance est une interruption de service.                                                                                                                                                                                                              |
| **Sauvegarde manuelle**                  | Aucune restauration n'a encore été rejouée — une sauvegarde jamais restaurée n'est pas une sauvegarde.                                                                                                                                                          |
| **Déploiement manuel (`scp` + `up -d`)** | Aucune trace de qui a déployé quoi, ni quand. Une chaîne d'intégration continue le corrigerait.                                                                                                                                                                 |

Ces écarts sont **connus et écrits**, ce qui les distingue de BUG-002 : un
écart documenté est un choix, un écart ignoré est une panne à retardement.
