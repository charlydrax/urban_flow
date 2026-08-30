/**
 * Consentement à la géolocalisation d'un **visiteur sans compte** (UF-802 — C8).
 *
 * ## Pourquoi un second lieu de stockage
 *
 * Pour un utilisateur connecté, le consentement est une donnée de profil :
 * horodatée par le serveur, opposable, révocable depuis l'écran de profil
 * (UF-107). Depuis qu'UF-801 a ouvert le planificateur aux visiteurs, ce
 * mécanisme ne couvre plus tout le monde — un invité n'a ni profil, ni
 * identifiant, ni ligne en base où poser une date.
 *
 * Trois issues étaient possibles ; celle-ci est la seule qui tienne :
 *
 * | Option                                   | Pourquoi elle est écartée / retenue                          |
 * | ---------------------------------------- | ------------------------------------------------------------- |
 * | Exiger un compte pour se localiser       | Ré-enferme l'invité derrière l'inscription qu'UF-801 a retirée |
 * | Créer un identifiant serveur pour l'invité | Collecter **plus** de données pour tracer un accord de ne rien collecter : contraire à la minimisation (C8) |
 * | **Mémoriser l'accord sur l'appareil**    | ✅ Retenue : la donnée reste chez la personne concernée        |
 *
 * L'accord d'un invité ne quitte donc jamais son navigateur, et il n'y a rien à
 * tracer côté serveur puisqu'il n'y a **rien à autoriser côté serveur** : la
 * position d'un invité sert au calcul en cours et n'est écrite nulle part
 * (`searchHistoryId: null` — voir le contrôleur `routes`).
 *
 * Retrait de l'accord : `forgetGuestGeolocationConsent`, câblé sur « Effacer ma
 * position » (`locate-me.tsx`). Le retrait doit être aussi simple que l'accord
 * (RGPD art. 7-3) et un invité n'a pas d'écran de profil où aller le chercher.
 *
 * Module **pur** : le stockage est injecté, donc testable en environnement
 * `node` sans jsdom (voir `vitest.config.ts`).
 */

/**
 * Clé de stockage local. Préfixée par le nom du produit : le domaine peut
 * héberger d'autres outils, et une clé nue comme `consent` finirait par entrer
 * en collision avec la leur.
 */
export const GUEST_GEOLOCATION_CONSENT_KEY = 'urbanflow.guest-geolocation-consent';

/** Valeur écrite. Sa présence vaut accord ; aucune autre valeur n'est acceptée. */
const CONSENT_GRANTED = 'granted';

/**
 * Stockage minimal attendu — sous-ensemble de `Storage` réellement utilisé.
 * Le typer ainsi permet d'injecter un double dans les tests sans reproduire
 * toute l'interface du DOM.
 */
export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Rend le `localStorage` du navigateur, ou `null` quand il est indisponible.
 *
 * Il l'est plus souvent qu'on ne le croit : rendu serveur (pas de `window`),
 * navigation privée de certains navigateurs, cookies tiers bloqués par une
 * politique d'entreprise. La simple **lecture** de `window.localStorage` y lève
 * une exception — d'où le `try` autour de l'accès lui-même, et pas seulement
 * autour des appels.
 */
function defaultStorage(): ConsentStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * L'invité a-t-il déjà donné son accord sur cet appareil ?
 *
 * @param storage Stockage à interroger (défaut : `localStorage`, `null` si indisponible)
 * @returns `true` seulement si un accord explicite y est inscrit
 */
export function readGuestGeolocationConsent(
  storage: ConsentStorage | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(GUEST_GEOLOCATION_CONSENT_KEY) === CONSENT_GRANTED;
  } catch {
    // Stockage plein, désactivé, ou quota refusé : on retombe sur « pas
    // d'accord connu ». Le panneau de consentement sera réaffiché — un clic de
    // plus, jamais une géolocalisation non consentie.
    return false;
  }
}

/**
 * Mémorise l'accord de l'invité sur son appareil.
 *
 * L'échec d'écriture est **volontairement silencieux** : le parcours doit
 * continuer. La seule conséquence est que le panneau réapparaîtra au prochain
 * clic, ce qui est le comportement sûr.
 *
 * @param storage Stockage à écrire (défaut : `localStorage`)
 */
export function rememberGuestGeolocationConsent(
  storage: ConsentStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(GUEST_GEOLOCATION_CONSENT_KEY, CONSENT_GRANTED);
  } catch {
    // Voir ci-dessus : ne rien mémoriser est une dégradation acceptable.
  }
}

/**
 * Retire l'accord mémorisé (RGPD art. 7-3 — le retrait aussi simple que l'accord).
 *
 * @param storage Stockage à nettoyer (défaut : `localStorage`)
 */
export function forgetGuestGeolocationConsent(
  storage: ConsentStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(GUEST_GEOLOCATION_CONSENT_KEY);
  } catch {
    // Rien à faire : l'accord n'était de toute façon pas lisible.
  }
}
