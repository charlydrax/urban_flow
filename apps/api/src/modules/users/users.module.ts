import { Module } from '@nestjs/common';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Module utilisateurs (F1) : profil de compte et préférences de mobilité
 * (modes favoris, accessibilité PMR — C12) consommées par le planificateur (F2).
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
