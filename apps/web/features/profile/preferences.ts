import {
  type MobilityPreferences,
  RoutePriority,
  TransportMode,
  type UpdateUserProfilePayload,
  type UserProfile,
} from '@urbanflow/shared';

/**
 * Logique du formulaire de profil (UF-107), isolée du rendu React.
 *
 * Tout ce qui décide *quoi envoyer à l'API* vit ici, sans dépendance au DOM ni
 * à Next : la règle est donc testable unitairement (`preferences.test.ts`) et le
 * composant se limite à l'affichage et aux états de chargement.
 */

/** Bornes du champ « marche maximale », alignées sur le DTO serveur (C4). */
export const MAX_WALK_MIN = 0;
export const MAX_WALK_MAX = 60;

/** Option de mode présentée à l'utilisateur (libellés FR — UI en français). */
export interface ModeOption {
  value: TransportMode;
  label: string;
  /** Pictogramme décoratif de la maquette Figma « 3. PROFIL F1 ». */
  icon: string;
}

/** Modes proposés, dans l'ordre d'affichage de la maquette (doux d'abord). */
export const MODE_OPTIONS: readonly ModeOption[] = [
  { value: TransportMode.WALK, label: 'Marche', icon: '🚶' },
  { value: TransportMode.BIKE, label: 'Vélo', icon: '🚲' },
  { value: TransportMode.SCOOTER, label: 'Trottinette', icon: '🛴' },
  { value: TransportMode.METRO, label: 'Métro', icon: '🚇' },
  { value: TransportMode.TRAM, label: 'Tramway', icon: '🚊' },
  { value: TransportMode.BUS, label: 'Bus', icon: '🚌' },
  { value: TransportMode.CARPOOL, label: 'Covoiturage', icon: '🚗' },
];

/** État éditable du formulaire : le profil, moins les champs en lecture seule. */
export interface ProfileDraft {
  preferences: MobilityPreferences;
  /** Consentement géolocalisation (C6/C8) — dérivé de `geolocationConsentAt`. */
  geolocationConsent: boolean;
}

/** Convertit le profil renvoyé par l'API en état de formulaire. */
export function toDraft(profile: UserProfile): ProfileDraft {
  return {
    preferences: {
      ...profile.preferences,
      preferredModes: [...profile.preferences.preferredModes],
    },
    geolocationConsent: profile.geolocationConsentAt !== null,
  };
}

/**
 * Ajoute ou retire un mode de la sélection.
 * L'ordre d'affichage est conservé quel que soit l'ordre de clic : sans cela,
 * les puces de la maquette sauteraient de place à chaque décochage.
 */
export function toggleMode(modes: readonly TransportMode[], mode: TransportMode): TransportMode[] {
  const next = modes.includes(mode) ? modes.filter((value) => value !== mode) : [...modes, mode];
  return MODE_OPTIONS.filter((option) => next.includes(option.value)).map((option) => option.value);
}

/**
 * Vérifie le brouillon avant envoi et renvoie le message à afficher, ou `null`.
 *
 * Ce contrôle est un **confort d'usage**, pas une sécurité : le serveur revalide
 * systématiquement les mêmes règles (C4). Il évite juste un aller-retour réseau
 * pour une erreur qu'on sait déjà (C5).
 */
export function validateDraft(draft: ProfileDraft): string | null {
  if (draft.preferences.preferredModes.length === 0) {
    return 'Sélectionnez au moins un mode de transport : sans mode accepté, aucun itinéraire ne peut vous être proposé.';
  }
  const walk = draft.preferences.maxWalkMinutes;
  if (!Number.isInteger(walk) || walk < MAX_WALK_MIN || walk > MAX_WALK_MAX) {
    return `Indiquez une durée de marche entière entre ${MAX_WALK_MIN} et ${MAX_WALK_MAX} minutes.`;
  }
  return null;
}

/** Compare deux sélections de modes indépendamment de l'ordre. */
function sameModes(a: readonly TransportMode[], b: readonly TransportMode[]): boolean {
  return a.length === b.length && a.every((mode) => b.includes(mode));
}

/**
 * Construit le corps du `PATCH` en ne retenant que ce qui a réellement changé.
 *
 * Renvoie `null` quand rien n'a bougé : le formulaire n'envoie alors aucune
 * requête. Éco-conception (C5) et robustesse — réémettre un profil inchangé
 * écraserait au passage les modifications faites entre-temps sur un autre
 * appareil.
 *
 * @param initial Profil tel que chargé depuis l'API
 * @param draft État courant du formulaire
 * @returns Le corps du PATCH, ou `null` s'il n'y a rien à enregistrer
 */
export function buildProfilePatch(
  initial: ProfileDraft,
  draft: ProfileDraft,
): UpdateUserProfilePayload | null {
  const preferences: Partial<MobilityPreferences> = {};

  if (!sameModes(initial.preferences.preferredModes, draft.preferences.preferredModes)) {
    preferences.preferredModes = draft.preferences.preferredModes;
  }
  if (initial.preferences.priority !== draft.preferences.priority) {
    preferences.priority = draft.preferences.priority;
  }
  if (initial.preferences.reducedMobility !== draft.preferences.reducedMobility) {
    preferences.reducedMobility = draft.preferences.reducedMobility;
  }
  if (initial.preferences.maxWalkMinutes !== draft.preferences.maxWalkMinutes) {
    preferences.maxWalkMinutes = draft.preferences.maxWalkMinutes;
  }

  const payload: UpdateUserProfilePayload = {};
  if (Object.keys(preferences).length > 0) payload.preferences = preferences;
  if (initial.geolocationConsent !== draft.geolocationConsent) {
    payload.geolocationConsent = draft.geolocationConsent;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

/** Libellé de la priorité d'itinéraire, tel qu'affiché dans la maquette. */
export const PRIORITY_LABELS: Record<RoutePriority, string> = {
  [RoutePriority.GREENEST]: 'Privilégier l’éco-mobilité',
  [RoutePriority.FASTEST]: 'Privilégier la rapidité',
};
