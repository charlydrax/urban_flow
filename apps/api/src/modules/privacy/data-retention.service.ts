import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SEARCH_HISTORY_RETENTION_DAYS } from '@urbanflow/shared';

import { PrismaService } from '../../prisma/prisma.service';

/** Nombre de millisecondes dans une journée — conversion de la durée de rétention. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Purge de l'historique de déplacements arrivé à échéance (UF-603, C8).
 *
 * ## Pourquoi une tâche planifiée, et pas une purge opportuniste
 *
 * Purger à l'écriture (« au prochain trajet enregistré, on nettoie les vieux »)
 * aurait évité une dépendance de plus. Mais ce sont précisément les **comptes
 * dormants** qui posent le problème RGPD : quelqu'un qui n'ouvre plus
 * l'application ne déclenche plus aucune écriture, et ses trajets — la donnée la
 * plus ré-identifiable du schéma — resteraient indéfiniment. Une limitation de
 * conservation qui ne s'applique qu'aux utilisateurs actifs n'en est pas une.
 *
 * ## Pourquoi la durée vient de `@urbanflow/shared`
 *
 * `SEARCH_HISTORY_RETENTION_DAYS` est la **même** constante que celle affichée
 * sur la page « Politique de confidentialité » de la PWA. Le délai annoncé à
 * l'utilisateur et le délai réellement appliqué en base ne peuvent donc pas
 * diverger : c'est la seule garantie qui vaille, une politique de rétention se
 * vérifiant sur les données, pas sur une page HTML.
 *
 * ## Ce qui n'est pas purgé
 *
 * Ni les comptes, ni les préférences : ils restent tant que l'utilisateur les
 * veut, et disparaissent quand il exerce son droit à l'effacement
 * (`DELETE /api/users/me`). Seuls les **déplacements** ont une échéance, parce
 * qu'ils sont la trace d'un comportement, pas un réglage.
 *
 * Couvre : C8 (limitation de la conservation — art. 5.1.e RGPD), C11 (journal
 * sans donnée personnelle), C5 (une requête indexée par jour, pas de balayage).
 */
@Injectable()
export class DataRetentionService {
  /** Journal d'exploitation : des décomptes, jamais un identifiant (C11). */
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Purge quotidienne, à 3 h du matin (heure du serveur).
   *
   * Le créneau est choisi hors des heures de déplacement : la purge écrit sur la
   * même table que l'enregistrement des recherches, et un `DELETE` massif à
   * 8 h 30 rallongerait le chemin critique du planificateur (C10).
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'purge-expired-search-history' })
  async purgeScheduled(): Promise<void> {
    const deleted = await this.purgeExpiredSearchHistory();
    if (deleted > 0) {
      this.logger.log(
        `Retention purge: ${deleted} search_history rows older than ` +
          `${SEARCH_HISTORY_RETENTION_DAYS} days deleted (GDPR art. 5.1.e)`,
      );
    }
  }

  /**
   * Supprime toutes les recherches dépassant la durée de conservation.
   *
   * Méthode publique et séparée du déclencheur `@Cron` pour rester testable
   * (et appelable à la main lors d'une recette) sans avoir à attendre 3 h du
   * matin ni à instrumenter l'ordonnanceur.
   *
   * La borne est calculée côté application plutôt qu'en SQL (`NOW() - INTERVAL`)
   * pour que `now` soit injectable dans les tests : une purge dont on ne peut
   * pas fixer l'horloge n'est pas vérifiable.
   *
   * L'index `(user_id, created_at)` ne couvre pas ce filtre — il porte sur le
   * couple, pas sur `created_at` seul. C'est assumé : la purge tourne une fois
   * par jour hors charge, tandis qu'ajouter un index sur `created_at` seul
   * coûterait à **chaque** enregistrement de trajet (C5).
   *
   * @param now Horodatage de référence (injectable pour les tests)
   * @returns Nombre de lignes effectivement supprimées
   */
  async purgeExpiredSearchHistory(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - SEARCH_HISTORY_RETENTION_DAYS * MS_PER_DAY);

    const { count } = await this.prisma.searchHistory.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return count;
  }
}
