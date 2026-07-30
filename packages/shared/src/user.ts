import type { RoutePriority } from './route-priority';
import type { TransportMode } from './transport-mode';

/**
 * Contrats du profil utilisateur (F1) — endpoints `GET/PATCH /api/users/me`.
 * Définis une seule fois ici (C9) : le back les implémente via des DTO Swagger,
 * le front les consomme via le client API typé.
 */

/**
 * Préférences de mobilité (F1) — lues par le Service Itinéraire à l'étape 3 du
 * flux de référence, puis appliquées au tri des options (F2).
 */
export interface MobilityPreferences {
  /** Modes de transport acceptés dans les itinéraires proposés. */
  preferredModes: TransportMode[];
  /** Arbitrage rapidité / empreinte carbone appliqué au tri des itinéraires. */
  priority: RoutePriority;
  /** Besoin d'itinéraires accessibles PMR (C12) — donnée sensible (C8). */
  reducedMobility: boolean;
  /** Durée de marche maximale acceptée par segment, en minutes. */
  maxWalkMinutes: number;
}

/**
 * Profil complet du compte connecté : identité **minimale** (C8) + préférences.
 * Aucune donnée d'authentification (hash, token) n'y figure jamais (C11).
 */
export interface UserProfile {
  id: string;
  email: string;
  /** Date de création du compte, au format ISO 8601. */
  createdAt: string;
  /**
   * Horodatage ISO du consentement à la géolocalisation, ou `null` s'il n'a
   * jamais été donné / a été révoqué. RGPD (C8) : le consentement doit être
   * traçable et révocable à tout moment.
   */
  geolocationConsentAt: string | null;
  preferences: MobilityPreferences;
}

/**
 * Corps de `PATCH /api/users/me` — sémantique **partielle** : tout champ absent
 * reste inchangé en base. Permet d'envoyer un seul réglage (ex. bascule d'un
 * interrupteur) sans réémettre tout le profil (C5, C10 : charge utile minimale).
 */
export interface UpdateUserProfilePayload {
  /** `true` accorde le consentement géolocalisation, `false` le révoque (C8). */
  geolocationConsent?: boolean;
  preferences?: Partial<MobilityPreferences>;
}
