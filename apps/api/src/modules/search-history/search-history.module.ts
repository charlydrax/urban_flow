import { Module } from '@nestjs/common';

import { SearchHistoryController } from './search-history.controller';
import { SearchHistoryService } from './search-history.service';

/**
 * Module Historique de recherche (UF-204).
 *
 * Le service est **exporté** : le planificateur (F2) devra y écrire à l'étape 18
 * du flux de référence, et le tableau de bord carbone y lira les trajets à
 * agréger. Il n'y a donc qu'un seul endroit dans le code qui connaisse la forme
 * des géométries PostGIS.
 */
@Module({
  controllers: [SearchHistoryController],
  providers: [SearchHistoryService],
  exports: [SearchHistoryService],
})
export class SearchHistoryModule {}
