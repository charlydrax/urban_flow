-- UF-204 — Persistance de l'historique de recherche.
--
-- Les extrémités d'un trajet passent de deux colonnes flottantes à de vraies
-- géométries PostGIS `geometry(Point, 4326)` (WGS84, le SRID des coordonnées
-- rendues par la Geolocation API et par la Base Adresse Nationale — C6/C9).
--
-- Migration écrite à la main : le SQL généré par Prisma supprimait les colonnes
-- `*_lat`/`*_lng` avant d'ajouter les colonnes géométriques, ce qui aurait perdu
-- l'historique déjà enregistré. On convertit d'abord, on supprime ensuite.

-- 1. Colonnes géométriques, d'abord nullables : le temps de la conversion, les
--    lignes existantes n'ont pas encore de valeur.
ALTER TABLE "search_history" ADD COLUMN "from_geom" geometry(Point, 4326);
ALTER TABLE "search_history" ADD COLUMN "to_geom" geometry(Point, 4326);

-- 2. Reprise de l'existant. ⚠️ `ST_MakePoint` prend (X, Y) donc (longitude,
--    latitude) — l'inverse de l'ordre d'écriture habituel « lat, lng ».
UPDATE "search_history"
SET "from_geom" = ST_SetSRID(ST_MakePoint("from_lng", "from_lat"), 4326),
    "to_geom"   = ST_SetSRID(ST_MakePoint("to_lng", "to_lat"), 4326)
WHERE "from_lat" IS NOT NULL AND "from_lng" IS NOT NULL
  AND "to_lat"   IS NOT NULL AND "to_lng"   IS NOT NULL;

-- 3. Une recherche sans coordonnées n'est pas convertible, et ne servait déjà à
--    rien : on ne peut ni la rejouer ni la cartographier. Les colonnes devenant
--    obligatoires, ces lignes sont purgées.
DELETE FROM "search_history" WHERE "from_geom" IS NULL OR "to_geom" IS NULL;

-- 4. Contrainte définitive : une ligne d'historique porte toujours ses deux points.
ALTER TABLE "search_history" ALTER COLUMN "from_geom" SET NOT NULL,
                             ALTER COLUMN "to_geom"   SET NOT NULL;

-- 5. Les colonnes flottantes n'ont plus de raison d'être.
ALTER TABLE "search_history" DROP COLUMN "from_lat",
                             DROP COLUMN "from_lng",
                             DROP COLUMN "to_lat",
                             DROP COLUMN "to_lng";

-- 6. Index spatial GiST sur le départ : c'est lui qui rend le choix du type
--    géométrique payant (requêtes de proximité `ST_DWithin` à venir).
CREATE INDEX "search_history_from_geom_idx" ON "search_history" USING GIST ("from_geom" gist_geometry_ops_2d);
