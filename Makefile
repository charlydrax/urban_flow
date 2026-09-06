# Makefile — UrbanFlow Mobility
# Raccourcis pour piloter l'environnement Docker (PostgreSQL + PostGIS).
# Usage : `make <cible>` (ex. `make up`). `make help` liste les cibles.
#
# Sous Windows, exécuter via Git Bash / WSL, ou installer `make`
# (ex. `choco install make`). Nécessite Docker Desktop avec Docker Compose v2.

# Binaire compose (Docker Compose v2 intégré au CLI Docker).
COMPOSE := docker compose
# Nom du service base de données défini dans docker-compose.yml.
DB_SERVICE := db
# Nom du service OpenTripPlanner (UF-301).
OTP_SERVICE := otp

# Préproduction (UF-607) : la surcharge se combine au compose de développement
# — les services de préproduction partagent son réseau pour joindre OTP.
PREPROD_COMPOSE := $(COMPOSE) -f docker-compose.yml -f docker-compose.preprod.yml
PREPROD_SERVICES := db-preprod api-preprod web-preprod

# Production (BUG-002) : compose AUTONOME, et secrets dans `.env.prod`.
# Ces cibles s'exécutent DEPUIS LE SERVEUR, dans /home/debian/urbanflow —
# pas depuis un poste de développement. Voir docs/production.md.
PROD_COMPOSE := $(COMPOSE) -f docker-compose.prod.yml --env-file .env.prod

.DEFAULT_GOAL := help

# Toutes les cibles sont des actions, pas des fichiers.
.PHONY: help up down stop start restart build ps logs db-shell db-wait \
        migrate generate studio reset prune clean \
        otp-data otp-data-force otp-up otp-logs otp-wait otp-test otp-rebuild otp-reset \
        cycle-import cycle-import-dry cycle-check \
        prod-config prod-up prod-ps prod-logs-api prod-pull prod-migrate \
        prod-migrate-status prod-health prod-backup \
        prod-otp-data prod-otp-up prod-otp-logs prod-otp-test

## help: Affiche la liste des cibles disponibles.
help:
	@echo "UrbanFlow — commandes Docker disponibles :"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //'

## up: Démarre les conteneurs en arrière-plan (détaché).
up:
	$(COMPOSE) up -d

## down: Arrête et supprime les conteneurs (les volumes sont conservés).
down:
	$(COMPOSE) down

## stop: Arrête les conteneurs sans les supprimer.
stop:
	$(COMPOSE) stop

## start: Redémarre des conteneurs précédemment arrêtés.
start:
	$(COMPOSE) start

## restart: Redémarre les conteneurs.
restart:
	$(COMPOSE) restart

## build: (Re)construit les images définies dans le compose.
build:
	$(COMPOSE) build

## ps: Liste l'état des conteneurs du projet.
ps:
	$(COMPOSE) ps

## logs: Suit les logs de tous les services (Ctrl+C pour quitter).
logs:
	$(COMPOSE) logs -f

## db-shell: Ouvre un shell psql dans le conteneur PostgreSQL.
db-shell:
	$(COMPOSE) exec $(DB_SERVICE) psql -U $${POSTGRES_USER:-urbanflow} -d $${POSTGRES_DB:-urbanflow}

## db-wait: Attend que la base soit prête (healthcheck pg_isready).
db-wait:
	@echo "Attente de la disponibilité de la base..."
	@until $(COMPOSE) exec -T $(DB_SERVICE) pg_isready -U $${POSTGRES_USER:-urbanflow} -d $${POSTGRES_DB:-urbanflow} >/dev/null 2>&1; do \
		sleep 1; \
	done
	@echo "Base prête."

## migrate: Applique les migrations Prisma (db doit tourner — voir `make up`).
migrate: up db-wait
	npm run db:migrate

## seed: Peuple la base de développement (comptes de démo — UF-701).
##       Le compte exploitant n'est créé que si DEMO_ADMIN_EMAIL et
##       DEMO_ADMIN_PASSWORD sont définis dans apps/api/.env ; sinon le seed
##       le saute en le disant, plutôt que de retomber sur des identifiants
##       devinables. Idempotent : relançable sans doublon.
seed: up db-wait
	npm run db:seed

## generate: Régénère le client Prisma.
generate:
	npm run db:generate

## studio: Lance Prisma Studio (UI base de données).
studio:
	npm run db:studio

# ---------------------------------------------------------------------------
# Pistes cyclables — jeu de données PostGIS (UF-304)
# ---------------------------------------------------------------------------

## cycle-import: Importe les amenagements cyclables du Grand Lyon dans PostGIS.
cycle-import: up db-wait
	npm run db:import:cycle-paths --workspace apps/api

## cycle-import-dry: Telecharge et filtre le flux sans rien ecrire en base.
cycle-import-dry:
	npm run db:import:cycle-paths --workspace apps/api -- --dry-run

## cycle-check: Recette UF-304 - volume, geometries valides, index GiST reellement utilise.
cycle-check:
	@$(COMPOSE) exec -T $(DB_SERVICE) psql -U $${POSTGRES_USER:-urbanflow} -d $${POSTGRES_DB:-urbanflow} \
		-c "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE NOT ST_IsValid(geom::geometry)) AS invalides, ROUND((SUM(ST_Length(geom))/1000)::numeric,1) AS km FROM cycle_paths;" \
		-c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'cycle_paths';" \
		-c "EXPLAIN (ANALYZE, COSTS OFF) SELECT source_id FROM cycle_paths WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(4.859057,45.760515),4326)::geography, 300);"

## reset: Détruit la base (volume inclus) puis la recrée à vide.
reset:
	$(COMPOSE) down -v
	$(COMPOSE) up -d

## prune: Supprime conteneurs ET volumes du projet (données perdues).
prune:
	$(COMPOSE) down -v

## clean: prune + nettoie les images orphelines du projet.
clean:
	$(COMPOSE) down -v --rmi local --remove-orphans

# ---------------------------------------------------------------------------
# OpenTripPlanner — moteur de routage transports en commun (UF-301)
# ---------------------------------------------------------------------------

## otp-data: Télécharge le GTFS TCL et le réseau OSM lyonnais (prérequis au graphe).
otp-data:
	./docker/otp/fetch-data.sh

## otp-data-force: Retélécharge les données même si elles sont déjà présentes.
otp-data-force:
	./docker/otp/fetch-data.sh --force

## otp-up: Démarre OTP (construit le graphe au premier lancement, plusieurs minutes).
otp-up:
	$(COMPOSE) up -d $(OTP_SERVICE)

## otp-logs: Suit les logs d'OTP (pour observer la construction du graphe).
otp-logs:
	$(COMPOSE) logs -f $(OTP_SERVICE)

## otp-wait: Attend qu'OTP réponde (le premier démarrage inclut le build du graphe).
otp-wait:
	@echo "Attente d'OpenTripPlanner (build du graphe au premier lancement)..."
	@until curl -fsS http://localhost:${OTP_PORT:-8080}/otp/ >/dev/null 2>&1; do \
		sleep 5; \
	done
	@echo "OTP pret."

## otp-test: Vérifie le calcul d'un trajet Part-Dieu vers Bellecour (recette UF-301).
otp-test:
	./docker/otp/test-route.sh

## otp-rebuild: Reconstruit le graphe après mise à jour du GTFS (procédure mensuelle).
otp-rebuild: otp-data-force
	OTP_FORCE_REBUILD=1 $(COMPOSE) up -d --force-recreate $(OTP_SERVICE)
	@echo "Reconstruction lancee - suivre l'avancement avec 'make otp-logs'."

## otp-reset: Supprime le graphe et le reconstruit de zéro (volume inclus).
otp-reset:
	$(COMPOSE) rm -sf $(OTP_SERVICE)
	docker volume rm dev_urbanflow_otp_graph || true
	$(COMPOSE) up -d $(OTP_SERVICE)

# ---------------------------------------------------------------------------
# Préproduction — environnement distinct du développement (UF-607)
# ---------------------------------------------------------------------------
# Prérequis : PREPROD_POSTGRES_PASSWORD et PREPROD_JWT_SECRET dans .env
# (voir .env.example), et OTP démarré si l'on veut de vrais itinéraires TC.
# Documentation : docs/preproduction.md.

## preprod-up: Construit et démarre la préproduction (web 3100, api 3101, db 5434).
preprod-up:
	$(PREPROD_COMPOSE) up -d --build $(PREPROD_SERVICES)
	@echo "Preproduction demarree : http://localhost:$${PREPROD_WEB_PORT:-3100}"
	@echo "Appliquer les migrations : make preprod-migrate"

## preprod-build: Reconstruit les images de préproduction sans les démarrer.
preprod-build:
	$(PREPROD_COMPOSE) build $(PREPROD_SERVICES)

## preprod-down: Arrête la préproduction (le volume de données est conservé).
preprod-down:
	$(PREPROD_COMPOSE) stop $(PREPROD_SERVICES)
	$(PREPROD_COMPOSE) rm -f $(PREPROD_SERVICES)

## preprod-ps: État des conteneurs de préproduction.
preprod-ps:
	$(PREPROD_COMPOSE) ps $(PREPROD_SERVICES)

## preprod-logs: Suit les journaux structurés des trois services.
preprod-logs:
	$(PREPROD_COMPOSE) logs -f $(PREPROD_SERVICES)

## preprod-logs-api: Journaux JSON de l'API seule (à filtrer avec jq).
preprod-logs-api:
	$(PREPROD_COMPOSE) logs -f api-preprod

## preprod-migrate: Applique les migrations Prisma sur la base de préproduction.
preprod-migrate:
	DATABASE_URL="postgresql://$${PREPROD_POSTGRES_USER:-urbanflow}:$${PREPROD_POSTGRES_PASSWORD}@localhost:$${PREPROD_POSTGRES_PORT:-5434}/$${PREPROD_POSTGRES_DB:-urbanflow_preprod}?schema=public" 		npm run db:migrate:deploy --workspace apps/api

## preprod-health: Sonde de santé de l'API de préproduction (API + base).
preprod-health:
	@curl -fsS http://localhost:$${PREPROD_API_PORT:-3101}/api/health && echo ""

## preprod-reset: Détruit la base de préproduction (volume inclus) et la recrée.
preprod-reset:
	$(PREPROD_COMPOSE) rm -sf $(PREPROD_SERVICES)
	docker volume rm dev_urbanflow_pgdata_preprod || true
	$(PREPROD_COMPOSE) up -d --build $(PREPROD_SERVICES)

# ---------------------------------------------------------------------------
# Production (BUG-002, #106) — à exécuter DEPUIS LE SERVEUR.
# Procédure complète, retour arrière et sauvegarde : docs/production.md
# ---------------------------------------------------------------------------

## prod-config: Valide docker-compose.prod.yml + .env.prod SANS rien démarrer.
prod-config:
	@$(PROD_COMPOSE) config --quiet && echo "Configuration de production valide."

## prod-up: Démarre (ou met à jour) la production.
prod-up: prod-config
	$(PROD_COMPOSE) up -d
	@echo "Verifier l'etat reel : make prod-ps  (attendu : Up (healthy))"

## prod-ps: État des services — la colonne STATUS doit dire (healthy).
prod-ps:
	@$(PROD_COMPOSE) ps

## prod-logs-api: Journaux structurés de l'API (Ctrl-C pour sortir).
prod-logs-api:
	$(PROD_COMPOSE) logs -f --tail=100 api

## prod-pull: Récupère les dernières images publiées (sans redémarrer).
prod-pull:
	$(PROD_COMPOSE) pull

# `migrate deploy`, jamais `migrate dev` : ce dernier peut proposer de
# réinitialiser la base. La CLI Prisma est une dépendance de développement,
# retirée de l'image par `npm prune` : on la récupère à la volée pour jouer le
# schéma embarqué dans l'image (voir docs/production.md § 4).
## prod-migrate: Applique les migrations Prisma sur la base de production.
prod-migrate:
	$(PROD_COMPOSE) exec api npx --yes prisma@6 migrate deploy --schema apps/api/prisma/schema.prisma

## prod-migrate-status: Liste les migrations réellement appliquées en production.
prod-migrate-status:
	@$(PROD_COMPOSE) exec db psql -U $${POSTGRES_USER:-urbanflow} -d $${POSTGRES_DB:-urbanflow} \
		-c 'SELECT migration_name FROM _prisma_migrations ORDER BY started_at;'

# La sonde qui manquait le soir de BUG-002 : elle distingue « Caddy répond » de
# « la pile fonctionne ». Interrogée depuis le serveur, sans passer par le proxy.
## prod-health: Sonde de santé de l'API de production (API + base).
prod-health:
	@$(PROD_COMPOSE) exec api wget -q -O - http://localhost:3001/api/health && echo ""

# ------------------------------- moteur de routage en production (BUG-003) --
# OTP est le seul service de production bâti sur place : le livrable n'est pas
# l'image mais le graphe, construit à partir de 85 Mo de données non versionnées.

## prod-otp-data: Télécharge GTFS + OSM sur le serveur (prérequis au graphe).
prod-otp-data:
	./docker/otp/fetch-data.sh

## prod-otp-up: Bâtit l'image OTP et démarre le moteur (1er lancement : plusieurs minutes).
prod-otp-up:
	$(PROD_COMPOSE) up -d --build $(OTP_SERVICE)
	@echo "Construction du graphe en cours : make prod-otp-logs"

## prod-otp-logs: Suit les journaux d'OTP (construction puis chargement du graphe).
prod-otp-logs:
	$(PROD_COMPOSE) logs -f --tail=100 $(OTP_SERVICE)

## prod-otp-test: Vérifie depuis l'API que le moteur répond (recette BUG-003).
prod-otp-test:
	@$(PROD_COMPOSE) exec api wget -q -O - --header='Content-Type: application/json' \
		--post-data='{"query":"{serviceTimeRange{start end}}"}' \
		http://otp:8080/otp/gtfs/v1 && echo ""

## prod-backup: Sauvegarde compressée de la base (données personnelles — C8/C11).
prod-backup:
	@$(PROD_COMPOSE) exec -T db pg_dump -U $${POSTGRES_USER:-urbanflow} $${POSTGRES_DB:-urbanflow} \
		| gzip > urbanflow-$$(date +%F).sql.gz
	@echo "Sauvegarde ecrite : urbanflow-$$(date +%F).sql.gz"
