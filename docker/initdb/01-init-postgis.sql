-- UF-002 — Activation de l'extension géospatiale PostGIS.
-- Exécuté automatiquement par docker-entrypoint-initdb.d au premier
-- démarrage du conteneur (base vide). Idempotent : IF NOT EXISTS.
-- Requis pour les requêtes ST_DWithin du planificateur d'itinéraires (C6/C9).
CREATE EXTENSION IF NOT EXISTS postgis;

-- Vérification loggée au démarrage : la version doit apparaître dans les
-- logs du conteneur (recette UF-002 : SELECT PostGIS_version();).
SELECT PostGIS_version();
