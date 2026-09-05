import { Module } from '@nestjs/common';

import { SimulationController } from './simulation.controller';
import { SimulationService } from './simulation.service';

/**
 * Module de simulation de trajet (UF-701) — l'outillage interne qui rend le
 * produit démontrable sans déplacement physique.
 *
 * ## Un module à part, et pas un endpoint de plus dans `routes`
 *
 * Le planificateur (F2) répond à un usager de la métropole ; ce module répond
 * à un exploitant qui montre le produit. Les mêler aurait posé, dans le module
 * le plus exposé de l'API, un endpoint dont le régime d'accès diffère de tous
 * ses voisins — et un régime d'accès qui dépend de la méthode qu'on lit est un
 * régime qu'on finit par oublier de vérifier. Ici, la réservation vaut pour le
 * contrôleur entier, et le module se retire d'un seul import le jour où le
 * prototype n'a plus à être démontré.
 *
 * ## Aucune dépendance
 *
 * Ni Prisma, ni Service Carbone, ni source de transport : la trace se déduit
 * entièrement des segments soumis. Le module ne lit ni n'écrit rien en base —
 * ce qui sera consigné du trajet simulé le sera par le chemin normal, à
 * l'arrivée du guidage (UF-807), exactement comme pour un trajet réel.
 *
 * Le contrôle d'accès, lui, ne vit pas ici : c'est le `RolesGuard` global qui
 * lit le `@Roles(UserRole.ADMIN)` du contrôleur (voir `AppModule`).
 */
@Module({
  controllers: [SimulationController],
  providers: [SimulationService],
})
export class SimulationModule {}
