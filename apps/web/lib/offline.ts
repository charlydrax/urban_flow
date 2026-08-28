/**
 * Ce que l'application **sait** et **dit** de son état hors-ligne (UF-601).
 *
 * Module **pur** : il ne connaît ni React, ni `navigator`, ni le service worker.
 * Il porte le contrat qui relie les deux (l'en-tête posé par `sw.ts`, lu par le
 * client API) et les textes affichés — ce qui le rend testable dans
 * l'environnement `node` de Vitest, comme `plan-feedback.ts`.
 *
 * Couvre : C1/C10 (mode hors-ligne annoncé et exploitable), C7 (message
 * explicite, sans jargon réseau), C11 (rien du détail technique n'est affiché).
 */

/**
 * En-tête posé par le service worker quand il sert une réponse depuis son
 * cache au lieu du réseau (`sw.ts`, `handlePlanRequest`).
 *
 * C'est le **seul** canal entre le worker et la page : une réponse servie
 * depuis le cache est un `200` en tout point identique à la vraie, et sans ce
 * marqueur l'écran présenterait un itinéraire périmé comme le résultat frais de
 * la recherche qu'on vient de lancer.
 */
export const CACHE_SOURCE_HEADER = 'X-UrbanFlow-Cache';

/** Valeur de {@link CACHE_SOURCE_HEADER} pour le dernier itinéraire mémorisé. */
export const LAST_ROUTE_MARKER = 'last-route';

/** Sous-ensemble de `Headers` réellement utilisé — garde la fonction testable sans DOM. */
interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Dit si une réponse a été servie par le cache hors-ligne du service worker.
 *
 * @param headers En-têtes de la réponse (`response.headers`)
 * @returns `true` si le worker a répondu depuis son cache de dernier itinéraire
 */
export function isServedFromCache(headers: HeaderReader): boolean {
  return headers.get(CACHE_SOURCE_HEADER) === LAST_ROUTE_MARKER;
}

/**
 * Bandeau permanent affiché tant que la connexion est perdue (recette 3).
 *
 * Le texte dit **ce qui reste possible**, pas seulement ce qui est cassé :
 * annoncer une panne sans dire ce qu'on peut encore faire pousse à fermer
 * l'application, alors que le dernier itinéraire et la carte déjà parcourue
 * sont précisément ce dont on a besoin dans un tunnel.
 *
 * Pas de bouton « réessayer » : le navigateur signale lui-même le retour du
 * réseau (`online`), et un bouton qui invite à réessayer sans réseau ne fait
 * qu'ajouter un échec de plus.
 */
export const OFFLINE_BANNER = {
  /** Étiquette courte, en gras — repérable d'un coup d'œil. */
  label: 'Mode hors-ligne',
  message:
    'Vous n’êtes plus connecté à Internet. Votre dernier itinéraire et la carte déjà consultée restent accessibles ; les nouvelles recherches reprendront au retour du réseau.',
} as const;
