import { ApiProperty } from '@nestjs/swagger';
import type { DeleteAccountResult } from '@urbanflow/shared';

/**
 * Réponse de `DELETE /api/users/me` — preuve d'exécution du droit à
 * l'effacement (art. 17 RGPD, C8 ; UF-603).
 *
 * Aucun champ n'est facultatif : un effacement partiel n'existe pas. Le corps
 * documente **ce qui a disparu**, jamais ce qui a été effacé — ni email, ni
 * lieu, ni horodatage de trajet ne réapparaissent ici (C11).
 */
export class DeleteAccountResultDto implements DeleteAccountResult {
  /** Identifiant technique du compte effacé (le seul identifiant restant). */
  @ApiProperty({ format: 'uuid', example: '11111111-1111-4111-8111-111111111111' })
  deletedUserId!: string;

  /** Nombre de trajets supprimés de l'historique avec le compte. */
  @ApiProperty({ example: 42, minimum: 0 })
  deletedSearchHistoryCount!: number;

  /** `true` si un profil de mobilité existait (dont la donnée sensible PMR). */
  @ApiProperty({ example: true })
  deletedMobilityProfile!: boolean;

  /** Horodatage serveur de l'effacement, ISO 8601 (C9). */
  @ApiProperty({ format: 'date-time', example: '2026-08-29T10:12:00.000Z' })
  deletedAt!: string;
}
