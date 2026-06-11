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

.DEFAULT_GOAL := help

# Toutes les cibles sont des actions, pas des fichiers.
.PHONY: help up down stop start restart build ps logs db-shell db-wait \
        migrate generate studio reset prune clean

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
	npm run prisma:migrate --workspace apps/api

## generate: Régénère le client Prisma.
generate:
	npm run prisma:generate --workspace apps/api

## studio: Lance Prisma Studio (UI base de données).
studio:
	npm run prisma:studio --workspace apps/api

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
