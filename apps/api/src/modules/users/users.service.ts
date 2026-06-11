import { Injectable } from '@nestjs/common';

import { TransportMode, UpdateMobilityProfileDto } from './dto/update-mobility-profile.dto';

/** Profil de mobilité tel qu'exposé par l'API. */
export interface MobilityProfileView {
  preferredModes: TransportMode[];
  reducedMobility: boolean;
  maxWalkMinutes: number;
}

/** Vue minimale d'un compte utilisateur (minimisation des données — C8). */
export interface UserView {
  id: string;
  email: string;
}

/**
 * Service utilisateurs (F1).
 *
 * ⚠️ SQUELETTE : réponses mock en mémoire, aucune lecture/écriture Prisma.
 * Implémentation cible : lecture/écriture des modèles `User` et
 * `MobilityProfile` (PostGIS), droit à l'effacement (C8).
 *
 * Couvre : F1, C8 (exposition minimale des données), C12 (préférence PMR).
 */
@Injectable()
export class UsersService {
  /**
   * Retourne le profil du compte courant (stub).
   * @param userId Identifiant issu du JWT vérifié (jamais du corps de requête — C4)
   */
  async getMe(userId: string): Promise<UserView> {
    // TODO(F1): SELECT en base via Prisma
    return { id: userId, email: 'marie@example.com' };
  }

  /**
   * Retourne les préférences de mobilité (stub).
   * Ces préférences sont lues par le Service Itinéraire à l'étape 3 du flux de référence.
   */
  async getMobilityProfile(_userId: string): Promise<MobilityProfileView> {
    // TODO(F1): lecture du MobilityProfile en base
    return {
      preferredModes: [TransportMode.WALK, TransportMode.METRO, TransportMode.BIKE],
      reducedMobility: false,
      maxWalkMinutes: 15,
    };
  }

  /**
   * Met à jour les préférences de mobilité (stub : renvoie l'écho validé).
   * @param dto Préférences validées par class-validator (C4)
   */
  async updateMobilityProfile(
    _userId: string,
    dto: UpdateMobilityProfileDto,
  ): Promise<MobilityProfileView> {
    // TODO(F1): upsert du MobilityProfile en base
    return {
      preferredModes: dto.preferredModes,
      reducedMobility: dto.reducedMobility ?? false,
      maxWalkMinutes: dto.maxWalkMinutes ?? 15,
    };
  }
}
