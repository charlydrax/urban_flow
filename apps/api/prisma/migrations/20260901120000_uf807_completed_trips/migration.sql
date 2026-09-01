-- UF-807 — trajet réalisé ≠ intention.
--
-- Jusqu'ici le suivi carbone comptait les lignes valorisées
-- (`carbon_grams IS NOT NULL`), c'est-à-dire l'itinéraire **retenu** au moment
-- du clic. Retenir n'est pas parcourir : un bilan nourri de sélections compte
-- des intentions, et un bilan d'intentions ne mesure rien.
--
-- Cette colonne porte le fait manquant : l'instant où le guidage (UF-806) a
-- atteint la destination. C'est elle, et non l'empreinte, qui fait désormais
-- entrer un trajet dans « Mon impact ».
--
-- Nullable, sans valeur par défaut : la ligne naît à l'étape 7 du flux, au
-- lancement de la recherche, bien avant qu'aucun déplacement n'ait eu lieu.
-- `NULL` dit « pas (encore) parcouru » — un horodatage par défaut dirait le
-- contraire de ce que le ticket corrige.
--
-- ⚠️ **Aucune reprise des lignes existantes**, volontairement. Les trajets déjà
-- valorisés en base sont des sélections : les marquer réalisés d'office
-- rétablirait exactement le défaut que ce ticket corrige. Ils restent dans
-- l'historique, et sont dénombrés à part par `GET /api/carbon/summary`
-- (`uncountedTripsCount`).
ALTER TABLE "search_history" ADD COLUMN "completed_at" TIMESTAMP(3);

-- Index sur « les trajets réalisés de ce compte » : c'est le filtre commun aux
-- trois lectures du tableau de bord depuis ce ticket. L'index
-- `(user_id, created_at)` continue d'ordonner la fenêtre ; celui-ci sert le
-- nouveau prédicat sans faire relire toute la fenêtre pour écarter les
-- recherches abandonnées (C5/C10).
CREATE INDEX "search_history_user_id_completed_at_idx" ON "search_history"("user_id", "completed_at");
