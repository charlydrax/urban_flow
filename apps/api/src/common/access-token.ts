import type { Request } from 'express';
import { ExtractJwt } from 'passport-jwt';

import { AUTH_COOKIE } from './auth-cookie';

/**
 * Extraction de l'access token d'une requête entrante (UF-104, UF-801).
 *
 * Le token est cherché **d'abord dans le cookie httpOnly** `access_token`
 * (inaccessible au JavaScript → protège contre le vol par XSS — C11), avec
 * repli sur l'en-tête `Authorization: Bearer` (Swagger, clients API).
 *
 * ## Pourquoi ce module existe
 *
 * Cette liste était écrite dans `JwtStrategy` et n'y servait qu'à elle, tant
 * que toute route était protégée. Depuis UF-801, l'accès invité oblige à poser
 * une seconde question sur la même requête : *un jeton a-t-il seulement été
 * présenté ?* — car un visiteur sans compte n'en présente aucun, tandis qu'un
 * cookie périmé en présente un, qui doit être refusé et non ignoré. Deux
 * lectures divergentes du même en-tête finiraient par ne plus s'accorder, et le
 * désaccord porterait sur qui a le droit d'entrer.
 *
 * Couvre : C4 (une seule définition de « la requête porte des identifiants »),
 * C11 (cookie httpOnly prioritaire sur l'en-tête).
 */

/** Extracteur passport-jwt : cookie httpOnly d'abord, en-tête `Bearer` ensuite. */
export const accessTokenExtractor = ExtractJwt.fromExtractors([
  (req: Request): string | null => (req.cookies?.[AUTH_COOKIE] as string | undefined) ?? null,
  ExtractJwt.fromAuthHeaderAsBearerToken(),
]);

/**
 * Indique si la requête **présente** des identifiants, sans rien en vérifier.
 *
 * Sert à distinguer les deux façons de ne pas être authentifié, que le guard
 * facultatif d'UF-801 traite à l'opposé l'une de l'autre :
 *
 * | Requête                     | Lecture               | Réponse sur `/routes/plan` |
 * | --------------------------- | --------------------- | -------------------------- |
 * | aucun jeton                 | visiteur invité       | `200`, sans historique     |
 * | jeton présent mais rejeté   | session morte/forgée  | `401`                      |
 *
 * Confondre les deux ferait taire silencieusement une expiration de session :
 * l'utilisateur continuerait de chercher des itinéraires en croyant son compte
 * actif, sans que rien ne soit enregistré ni qu'aucun écran ne le prévienne.
 *
 * @param request Requête Express en cours de traitement
 * @returns `true` si un jeton a été transmis (cookie ou en-tête), quel qu'en soit l'état
 */
export function hasAccessTokenCredentials(request: Request): boolean {
  return accessTokenExtractor(request) !== null;
}
