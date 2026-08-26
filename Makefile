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

.DEFAULT_GOAL := help

# Toutes les cibles sont des actions, pas des fichiers.
.PHONY: help up down stop start restart build ps logs db-shell db-wait \
        migrate generate studio reset prune clean \
        otp-data otp-data-force otp-up otp-logs otp-wait otp-test otp-rebuild otp-reset \
        cycle-import cycle-import-dry cycle-check

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
