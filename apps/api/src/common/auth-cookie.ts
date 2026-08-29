import type { CookieOptions, Response } from 'express';

/**
 * Cookie de session — pose et purge au même endroit (C4/C11, UF-603).
 *
 * Ce fichier existe pour une raison précise : `res.clearCookie()` n'efface un
 * cookie que si on lui redonne **les mêmes attributs** qu'à la pose (`path`,
 * `sameSite`, `secure`). Tant qu'un seul contrôleur posait et purgeait, la
 * duplication était sans danger ; depuis que la suppression de compte (UF-603)
 * doit elle aussi purger la session, deux copies divergentes laisseraient un
 * cookie de session survivre à l'effacement du compte — l'utilisateur croirait
 * son compte supprimé tout en restant « connecté » à l'écran.
 *
 * Les attributs sont donc écrits une fois, et lus par tous les appelants.
 */

/** Nom du cookie portant l'access token JWT. */
export const AUTH_COOKIE = 'access_token';

/**
 * Attributs du cookie de session.
 *
 * - `httpOnly` : hors de portée du JavaScript, donc invulnérable au vol par XSS (C11).
 * - `sameSite: 'lax'` : le cookie ne part pas sur une requête déclenchée par un
 *   site tiers, ce qui coupe la CSRF sur les routes d'écriture (C4 / OWASP A01).
 * - `secure` en production : le cookie n'est **jamais** émis en clair sur HTTP.
 *   Conditionné à `NODE_ENV` parce que le développement local tourne en HTTP :
 *   un `secure` inconditionnel rendrait la session inutilisable hors HTTPS.
 *   Le déploiement, lui, impose HTTPS de bout en bout (recette 4 d'UF-603).
 * - `path: '/'` : le cookie couvre toute l'API, y compris `/api/users/me`.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/**
 * Pose le cookie de session après authentification réussie (F1).
 * @param res Réponse Express (obtenue via `@Res({ passthrough: true })`)
 * @param token JWT signé par `AuthService`
 */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, AUTH_COOKIE_OPTIONS);
}

/**
 * Purge le cookie de session — déconnexion (UF-106) et effacement de compte
 * (UF-603). Idempotent : purger une session déjà absente est sans effet.
 * @param res Réponse Express (obtenue via `@Res({ passthrough: true })`)
 */
export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, AUTH_COOKIE_OPTIONS);
}
