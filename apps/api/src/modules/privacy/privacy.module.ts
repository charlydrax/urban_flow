import { Module } from '@nestjs/common';

import { DataRetentionService } from './data-retention.service';

/**
 * Module conformité RGPD (UF-603, C8/C11).
 *
 * Il n'expose **aucun contrôleur** : les droits de l'utilisateur s'exercent là
 * où il est déjà (son profil — `DELETE /api/users/me`), pas dans un espace
 * « RGPD » séparé qu'il faudrait aller chercher. Ce qui vit ici, c'est ce que
 * personne ne déclenche : la limitation de la conservation, qui doit s'appliquer
 * même — et surtout — aux comptes que plus personne n'ouvre.
 */
@Module({
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class PrivacyModule {}
