/**
 * Résolution de l'URL de base de l'API (UF-004), partagée par les deux clients
 * qui parlent au serveur : le client typé `api-client.ts` et le signalement
 * d'erreurs `error-reporting.ts` (UF-607).
 *
 * Extraite dans son propre module parce que deux copies de cette fonction, ce
 * sont deux endroits où le fail-fast peut diverger — et le jour où l'un des
 * deux se met à viser une API par défaut en production, personne ne le voit.
 */

/**
 * URL de base de l'API Gateway, préfixe `/api` compris.
 *
 * En production, une variable absente est une erreur de configuration
 * explicite (fail-fast, C4) : mieux vaut un écran cassé au premier appel qu'une
 * PWA qui parle silencieusement à `localhost`. En développement seulement,
 * repli sur l'API locale.
 *
 * @returns L'URL de base, sans barre oblique finale
 * @throws {Error} en production si `NEXT_PUBLIC_API_URL` n'est pas définie
 */
export function resolveApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not defined - set it in apps/web/.env (see apps/web/.env.example)',
    );
  }
  return 'http://localhost:3001/api';
}
