import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MobilityProfile, Prisma } from '@prisma/client';
import type { DeleteAccountResult } from '@urbanflow/shared';

import { PrismaService } from '../../prisma/prisma.service';
import {
  MobilityPreferencesDto,
  RoutePriority,
  TransportMode,
  UpdateUserProfileDto,
} from './dto/update-user-profile.dto';

/** Préférences de mobilité telles qu'exposées par l'API. */
export interface MobilityPreferencesView {
  preferredModes: TransportMode[];
  priority: RoutePriority;
  reducedMobility: boolean;
  maxWalkMinutes: number;
  /** Budget carbone mensuel, en grammes, ou `null` si aucun objectif n'est fixé (UF-805). */
  monthlyCarbonGoalGrams: number | null;
}

/** Profil complet du compte connecté (minimisation des données — C8). */
export interface UserProfileView {
  id: string;
  email: string;
  createdAt: string;
  geolocationConsentAt: string | null;
  preferences: MobilityPreferencesView;
}

/**
 * Préférences servies aux comptes qui n'ont pas encore enregistré les leurs.
 *
 * Le défaut « écolo » est un choix produit assumé : orienter vers les mobilités
 * douces est la proposition de valeur d'UrbanFlow. Les valeurs sont alignées
 * sur les `@default` du schéma Prisma, pour qu'un profil implicite et un profil
 * fraîchement créé se comportent exactement pareil.
 */
export const DEFAULT_PREFERENCES: MobilityPreferencesView = {
  preferredModes: [TransportMode.WALK, TransportMode.METRO, TransportMode.BIKE],
  priority: RoutePriority.GREENEST,
  reducedMobility: false,
  maxWalkMinutes: 15,
  // Pas d'objectif par défaut : en imposer un serait décider à la place de
  // l'usager de ce qui constitue pour lui un bon mois (UF-805).
  monthlyCarbonGoalGrams: null,
};

/** Compte + profil de mobilité tels que lus en base (colonnes strictement utiles — C8). */
type UserWithProfile = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    createdAt: true;
    consentAt: true;
    mobilityProfile: true;
  };
}>;

/**
 * Colonnes lues pour construire un profil. Sélection explicite : le
 * `passwordHash` ne doit jamais quitter la couche d'accès aux données (C11),
 * et on ne transporte pas d'octets inutiles (C5).
 */
const PROFILE_SELECT = {
  id: true,
  email: true,
  createdAt: true,
  consentAt: true,
  mobilityProfile: true,
} as const;

/**
 * Service utilisateurs (F1, UF-107) — profil de compte et préférences de mobilité.
 *
 * **Règle d'isolation** : toute méthode prend un `userId` issu du JWT vérifié et
 * l'utilise comme clé de la requête Prisma. Il n'existe volontairement aucune
 * méthode « lire le profil de X » : un utilisateur ne peut donc accéder qu'à
 * SON profil, quelles que soient les données envoyées (C4 / OWASP A01 —
 * recette 2 du ticket).
 *
 * Couvre : F1, C4 (identité issue du token), C8 (minimisation + consentement
 * géoloc révocable), C11 (le hash de mot de passe n'est jamais sélectionné),
 * C12 (préférence PMR transmise au planificateur).
 */
@Injectable()
export class UsersService {
  /**
   * Journal d'audit de l'effacement (C8/C11).
   *
   * Il consigne **l'événement**, jamais la personne : identifiant technique et
   * décomptes, ni email ni trajet. Une trace RGPD qui recopierait les données
   * qu'on vient d'effacer les ferait survivre dans les logs — c'est exactement
   * ce que l'article 17 interdit.
   */
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retourne le profil du compte connecté.
   *
   * Une lecture n'écrit jamais : un compte sans ligne `MobilityProfile` reçoit
   * les préférences par défaut sans que rien ne soit créé en base (C5 —
   * pas d'écriture inutile ; la ligne naît au premier enregistrement réel).
   *
   * @param userId Identifiant issu du JWT vérifié (jamais du corps de requête — C4)
   * @returns Identité minimale, état du consentement et préférences effectives
   * @throws NotFoundException (404) si le compte n'existe plus (token encore
   *   valide après suppression du compte — droit à l'effacement, C8)
   */
  async getProfile(userId: string): Promise<UserProfileView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_SELECT,
    });

    if (!user) throw new NotFoundException('User not found');

    return UsersService.toProfileView(user);
  }

  /**
   * Met à jour le profil du compte connecté (`PATCH` : mise à jour partielle).
   *
   * Les deux écritures possibles (consentement RGPD et préférences) sont faites
   * dans **une seule transaction** : un profil à moitié enregistré serait pire
   * que pas d'enregistrement du tout, notamment pour la traçabilité du
   * consentement (C8).
   *
   * Le consentement géolocalisation n'est ré-horodaté que lorsqu'il change
   * réellement : ré-enregistrer ses préférences ne doit pas réécrire la date du
   * consentement initial, qui fait foi en cas de contrôle (C8).
   *
   * @param userId Identifiant issu du JWT vérifié (C4)
   * @param dto Champs à modifier, validés par class-validator (C4)
   * @returns Le profil complet **relu après écriture** (l'UI affiche l'état réel en base)
   * @throws NotFoundException (404) si le compte n'existe plus
   */
  async updateProfile(userId: string, dto: UpdateUserProfileDto): Promise<UserProfileView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: PROFILE_SELECT,
      });

      if (!current) throw new NotFoundException('User not found');

      if (dto.geolocationConsent !== undefined) {
        const alreadyGranted = current.consentAt !== null;
        if (dto.geolocationConsent !== alreadyGranted) {
          await tx.user.update({
            where: { id: userId },
            // Révocation = effacement de la trace de consentement (C8).
            data: { consentAt: dto.geolocationConsent ? new Date() : null },
          });
        }
      }

      if (dto.preferences) {
        const patch = UsersService.toPreferencesPatch(dto.preferences);
        await tx.mobilityProfile.upsert({
          where: { userId },
          // Premier enregistrement : les champs non fournis prennent les défauts produit.
          create: { userId, ...DEFAULT_PREFERENCES, ...patch },
          update: patch,
        });
      }

      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: PROFILE_SELECT });
    });

    return UsersService.toProfileView(updated);
  }

  /**
   * Efface le compte connecté **et toutes ses données** — droit à l'effacement
   * (art. 17 RGPD, C8 ; recette 3 du ticket UF-603).
   *
   * L'effacement est **réel, pas logique** : pas de colonne `deletedAt`, pas de
   * ligne anonymisée conservée « au cas où ». Un compte marqué supprimé reste un
   * compte, et l'historique de déplacements est justement la donnée que le
   * recoupement rend ré-identifiable (domicile = point de départ récurrent du
   * matin). La ligne `users` part, et les suppressions en cascade déclarées au
   * schéma emportent `mobility_profiles` (dont la donnée sensible PMR) et
   * `search_history`.
   *
   * Les décomptes sont relevés **avant** le `DELETE`, dans la même transaction :
   * après, il n'y a plus rien à compter, et hors transaction un enregistrement
   * concurrent fausserait le total rendu à l'utilisateur.
   *
   * Le cookie de session est purgé par le contrôleur : le JWT déjà émis reste
   * cryptographiquement valide jusqu'à son expiration, mais toute route
   * protégée répondra désormais 404 — le compte qu'il désigne n'existe plus.
   *
   * @param userId Identifiant issu du JWT vérifié (jamais du corps — C4)
   * @returns Preuve d'exécution : ce qui a réellement été supprimé
   * @throws NotFoundException (404) si le compte a déjà été effacé
   */
  async deleteAccount(userId: string): Promise<DeleteAccountResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      if (!user) throw new NotFoundException('User not found');

      const [deletedSearchHistoryCount, mobilityProfileCount] = await Promise.all([
        tx.searchHistory.count({ where: { userId } }),
        tx.mobilityProfile.count({ where: { userId } }),
      ]);

      // La cascade du schéma fait le reste : une seule suppression suffit.
      await tx.user.delete({ where: { id: userId } });

      return {
        deletedUserId: userId,
        deletedSearchHistoryCount,
        deletedMobilityProfile: mobilityProfileCount > 0,
        deletedAt: new Date().toISOString(),
      };
    });

    this.logger.log(
      `Account erased (GDPR art. 17): user=${result.deletedUserId} ` +
        `history=${result.deletedSearchHistoryCount} profile=${result.deletedMobilityProfile}`,
    );

    return result;
  }

  /**
   * Préférences effectives d'un utilisateur, prêtes à être consommées par le
   * planificateur (F2, étape 3 du flux de référence).
   * @param userId Identifiant issu du JWT vérifié (C4)
   */
  async getPreferences(userId: string): Promise<MobilityPreferencesView> {
    const profile = await this.prisma.mobilityProfile.findUnique({ where: { userId } });
    return UsersService.toPreferencesView(profile);
  }

  /** Projette une ligne base en vue d'API (dates sérialisées en ISO 8601 — C9). */
  private static toProfileView(user: UserWithProfile): UserProfileView {
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      geolocationConsentAt: user.consentAt?.toISOString() ?? null,
      preferences: UsersService.toPreferencesView(user.mobilityProfile),
    };
  }

  /**
   * Préférences d'une ligne `MobilityProfile`, ou les défauts si elle n'existe pas.
   *
   * `preferredModes` et `priority` sont stockés en `String`/`String[]` (Prisma ne
   * partage pas l'enum TypeScript avec PostgreSQL) : les valeurs relues sont
   * donc re-filtrées ici. Une valeur devenue inconnue (mode retiré du catalogue)
   * est ignorée au lieu de propager une chaîne invalide jusqu'au front.
   */
  private static toPreferencesView(profile: MobilityProfile | null): MobilityPreferencesView {
    if (!profile) return { ...DEFAULT_PREFERENCES };

    const modes = profile.preferredModes.filter((mode): mode is TransportMode =>
      Object.values(TransportMode).includes(mode as TransportMode),
    );

    return {
      preferredModes: modes.length > 0 ? modes : [...DEFAULT_PREFERENCES.preferredModes],
      priority: Object.values(RoutePriority).includes(profile.priority as RoutePriority)
        ? (profile.priority as RoutePriority)
        : DEFAULT_PREFERENCES.priority,
      reducedMobility: profile.reducedMobility,
      maxWalkMinutes: profile.maxWalkMinutes,
      monthlyCarbonGoalGrams: profile.monthlyCarbonGoalGrams,
    };
  }

  /**
   * Ne retient que les champs réellement fournis.
   * Sans ce filtrage, un `undefined` explicite écraserait la colonne côté
   * `create` de l'upsert — le `PATCH` cesserait d'être partiel.
   */
  private static toPreferencesPatch(
    preferences: MobilityPreferencesDto,
  ): Partial<MobilityPreferencesView> {
    const patch: Partial<MobilityPreferencesView> = {};
    if (preferences.preferredModes !== undefined) patch.preferredModes = preferences.preferredModes;
    if (preferences.priority !== undefined) patch.priority = preferences.priority;
    if (preferences.reducedMobility !== undefined)
      patch.reducedMobility = preferences.reducedMobility;
    if (preferences.maxWalkMinutes !== undefined) patch.maxWalkMinutes = preferences.maxWalkMinutes;
    // `!== undefined` et non un test de véracité : `null` est une valeur
    // signifiante ici — c'est ainsi que l'usager RETIRE son objectif, là où
    // l'absence du champ le laisse inchangé (UF-805).
    if (preferences.monthlyCarbonGoalGrams !== undefined)
      patch.monthlyCarbonGoalGrams = preferences.monthlyCarbonGoalGrams;
    return patch;
  }
}
