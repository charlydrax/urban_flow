/**
 * @urbanflow/shared — types TypeScript partagés entre apps/web et apps/api.
 * Contrats d'API (DTO, itinéraires) définis une seule fois (C9) : le back les
 * implémente (classes DTO Swagger), le front les consomme (client API typé).
 */
export * from './transport-mode';
export * from './route-priority';
export * from './route';
export * from './auth';
export * from './carbon';
