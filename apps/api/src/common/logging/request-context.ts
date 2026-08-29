import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexte propagé le long d'une requête HTTP (UF-607).
 *
 * Volontairement réduit à un identifiant technique : c'est le seul champ dont
 * la corrélation a besoin, et tout ce qu'on ajouterait ici (e-mail, position,
 * corps de requête) finirait mécaniquement dans les journaux — ce que C11
 * interdit. L'identifiant de compte lui-même en est absent : il désigne une
 * personne, et un journal d'exploitation n'a pas à savoir qui a cherché quoi.
 */
export interface RequestContext {
  /** Identifiant de corrélation de la requête (`X-Request-Id`). */
  requestId: string;
}

/**
 * Stockage par requête, façon « variable de thread » pour Node.
 *
 * Pourquoi un `AsyncLocalStorage` plutôt que de passer l'identifiant de main en
 * main : les services métier (fusion d'itinéraires, connecteurs GTFS/GBFS)
 * journalisent depuis plusieurs couches sous le contrôleur. Leur faire porter
 * un paramètre `requestId` polluerait chaque signature d'un détail
 * d'observabilité, et le premier oubli casserait la chaîne au moment précis où
 * on en a besoin — l'incident.
 */
const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Exécute `callback` avec un contexte de requête actif.
 * @param context Contexte à rendre visible pendant l'exécution
 * @param callback Suite du traitement de la requête
 */
export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

/**
 * Contexte de la requête en cours, s'il y en a une.
 *
 * Rend `undefined` hors requête (démarrage, tâche planifiée de purge RGPD, test
 * unitaire) : la journalisation doit continuer de fonctionner sans contexte,
 * elle omet simplement le champ de corrélation.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Identifiant de corrélation de la requête en cours, ou `undefined` hors requête. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
