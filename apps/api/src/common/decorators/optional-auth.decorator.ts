import { SetMetadata } from '@nestjs/common';

/** Clé de métadonnée lue par le `JwtAuthGuard` pour identifier les routes à auth facultative. */
export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Marque un endpoint comme **ouvert aux invités sans perdre l'identité des
 * connectés** (UF-801).
 *
 * ## Pourquoi ce décorateur, et pas `@Public()`
 *
 * `@Public()` court-circuite le guard : la stratégie Passport n'est jamais
 * jouée, donc `request.user` reste vide **même quand un jeton parfaitement
 * valide accompagne la requête**. Un utilisateur connecté deviendrait anonyme
 * aux yeux du contrôleur — il perdrait son profil de mobilité et son historique
 * sans qu'aucune erreur ne le signale. C'est exactement le piège que le ticket
 * UF-801 demande d'éviter.
 *
 * `@OptionalAuth()` joue la stratégie normalement, et ne fait qu'une chose de
 * moins que le régime par défaut : **ne pas exiger** de jeton.
 *
 * ```
 * jeton valide     → request.user renseigné   → parcours connecté complet
 * aucun jeton      → request.user vide        → parcours invité (200)
 * jeton invalide   → 401                      → session morte, il faut le dire
 * ```
 *
 * La troisième ligne est le point délicat : un cookie périmé n'est pas
 * l'absence de compte. Tolérer un jeton rejeté ferait basculer un utilisateur
 * en mode invité en silence, sans écran de reconnexion et sans historique.
 *
 * ## Portée
 *
 * À réserver aux endpoints dont le résultat est **le même pour tous** et dont
 * la personnalisation est un bonus (le planificateur). Une donnée qui
 * appartient à quelqu'un — historique, bilan carbone, profil — n'a rien à faire
 * ici : ces routes restent sous le régime par défaut (C4).
 *
 * Couvre : C4 (l'authentification reste la règle, l'exemption est nominative),
 * C7/C2 (le service de base est atteignable sans compte).
 *
 * @example
 * ```ts
 * @OptionalAuth()
 * @Post('plan')
 * plan(@Body() dto: PlanRouteDto, @OptionalUser() user: AuthenticatedUser | null) { ... }
 * ```
 */
export const OptionalAuth = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
