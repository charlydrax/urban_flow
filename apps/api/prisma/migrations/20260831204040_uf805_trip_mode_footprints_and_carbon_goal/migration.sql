-- UF-805 — mise en conformité de l'écran suivi carbone avec la planche.
--
-- Deux ajouts, tous deux au service de blocs de la maquette « 8. EMPREINTE
-- CARBONE » que UF-505 avait laissés de côté faute d'endroit où ranger la
-- donnée.
--
-- 1. `trip_mode_footprints` — l'empreinte du trajet retenu, ventilée par mode.
--    UF-505 ne conservait que deux totaux par recherche, ce qui rendait la
--    « Répartition des émissions » et la colonne « Distance » du tableau par
--    trajet littéralement incalculables. Une ligne par mode (et non par
--    segment) : trois arrêts de bus successifs forment une seule barre à
--    l'écran, agréger à l'écriture évite de stocker puis de regrouper cinq fois
--    plus de lignes à chaque lecture (C5/C10).
--
--    Les valeurs sont figées au barème du jour du trajet, même règle que
--    `car_equivalent_grams` (migration UF-505) : un bilan personnel dont les
--    mois passés se réécriraient à chaque affinage du barème ADEME ne serait
--    pas un historique.
--
--    L'unicité `(search_history_id, mode)` garantit que la somme des lignes
--    égale `search_history.carbon_grams` et rend l'écriture d'une sélection
--    réexécutable sans dupliquer.
--
--    RGPD (C8) : donnée de déplacement. `ON DELETE CASCADE` prolonge jusqu'ici
--    la chaîne d'effacement compte → recherche → empreintes.
--
-- 2. `mobility_profiles.monthly_carbon_goal_grams` — le budget carbone mensuel
--    de la maquette (« Objectif : rester sous 16 kg »). Nullable et sans
--    défaut : « pas encore choisi » n'est pas « objectif à zéro », le second
--    afficherait un dépassement perpétuel à tout compte neuf.
--
-- Les données déjà en base ne sont pas rétro-alimentées : les trajets retenus
-- avant cette migration gardent leurs totaux mais n'ont pas de ventilation par
-- mode. L'écran le dit plutôt que de répartir au hasard — voir
-- `CarbonService.getSummary`.

-- AlterTable
ALTER TABLE "mobility_profiles" ADD COLUMN     "monthly_carbon_goal_grams" INTEGER;

-- CreateTable
CREATE TABLE "trip_mode_footprints" (
    "id" UUID NOT NULL,
    "search_history_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "grams" INTEGER NOT NULL,

    CONSTRAINT "trip_mode_footprints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_mode_footprints_search_history_id_idx" ON "trip_mode_footprints"("search_history_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_mode_footprints_search_history_id_mode_key" ON "trip_mode_footprints"("search_history_id", "mode");

-- AddForeignKey
ALTER TABLE "trip_mode_footprints" ADD CONSTRAINT "trip_mode_footprints_search_history_id_fkey" FOREIGN KEY ("search_history_id") REFERENCES "search_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;
