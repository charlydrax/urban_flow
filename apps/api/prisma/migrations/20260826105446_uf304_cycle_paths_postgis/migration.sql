-- UF-304 — Aménagements cyclables de la Métropole de Lyon en PostGIS.
--
-- Troisième source du `Promise.all` du Service Itinéraire (étape 4 du flux de
-- référence), et la seule que nous hébergeons : le réseau cyclable est une
-- donnée de patrimoine, pas un flux temps réel.
--
-- Le contenu est chargé par `npm run db:import:cycle-paths` (script d'import
-- depuis le flux WFS ouvert du Grand Lyon) — cf. docs/cycle-paths-postgis.md.

-- CreateTable
--
-- `geom` est de type **geography** et non geometry : c'est ce qui donne à
-- ST_DWithin une distance en mètres (calcul sur l'ellipsoïde) au lieu de degrés.
-- Sur une geometry(4326), `ST_DWithin(geom, point, 500)` chercherait dans un
-- rayon de 500 DEGRÉS ; la même requête en geography cherche à 500 mètres.
CREATE TABLE "cycle_paths" (
    "id" UUID NOT NULL,
    "source_id" TEXT NOT NULL,
    "name" TEXT,
    "facility_type" TEXT NOT NULL,
    "network" TEXT,
    "surface" TEXT,
    "geom" geography(MultiLineString, 4326) NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycle_paths_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- Clé de rapprochement avec le producteur (`gid` du flux Grand Lyon). C'est elle
-- qui rend le réimport idempotent : un tronçon corrigé est mis à jour via
-- ON CONFLICT, jamais dupliqué.
CREATE UNIQUE INDEX "cycle_paths_source_id_key" ON "cycle_paths"("source_id");

-- CreateIndex
--
-- Index spatial GiST — exigence explicite de la recette du ticket (C10).
-- Sans lui, chaque recherche d'itinéraire imposerait 4 700 calculs de distance
-- ellipsoïdale ; avec lui, l'index élimine par boîtes englobantes et le calcul
-- exact ne porte que sur les candidats restants.
--
-- L'opclass est `gist_geography_ops` (et non `gist_geometry_ops_2d` comme sur
-- search_history) : elle indexe les boîtes englobantes sur la sphère, ce que la
-- colonne geography impose.
CREATE INDEX "cycle_paths_geom_idx" ON "cycle_paths" USING GIST ("geom" gist_geography_ops);
