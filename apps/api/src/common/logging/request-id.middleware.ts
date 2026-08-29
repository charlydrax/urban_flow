import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { runWithRequestContext } from './request-context';

/** En-tête portant l'identifiant de corrélation, à l'aller comme au retour. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Longueur maximale acceptée pour un identifiant fourni par le client.
 *
 * L'en-tête est une **entrée utilisateur** : elle est reprise dans les journaux
 * et dans la réponse d'erreur. Sans borne, n'importe qui peut gonfler chaque
 * ligne de journal (déni de service par le disque) ; sans filtre de caractères,
 * on y glisse un saut de ligne et on forge une fausse ligne de journal (OWASP
 * A09). Un UUID fait 36 caractères ; 64 laissent de la marge aux traceurs tiers
 * sans ouvrir la porte.
 */
const MAX_CLIENT_REQUEST_ID_LENGTH = 64;

/** Alphabet toléré : celui des identifiants de trace usuels, rien de plus. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]+$/;

/**
 * Retient l'identifiant proposé par le client s'il est exploitable, sinon en
 * fabrique un.
 *
 * Faire confiance au client a une vraie valeur ici : le front génère
 * l'identifiant avant l'appel, l'affiche à l'usager en cas d'erreur, et la même
 * chaîne se retrouve dans les journaux serveur — c'est ce qui permet à un
 * signalement de bogue de pointer la trace exacte (voir docs/bug-process.md).
 * Mais il n'est repris que s'il ressemble à un identifiant.
 *
 * @param headerValue Valeur brute de l'en-tête `X-Request-Id`
 * @returns L'identifiant retenu pour cette requête
 */
export function resolveRequestId(headerValue: string | string[] | undefined): string {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (
    candidate !== undefined &&
    candidate.length > 0 &&
    candidate.length <= MAX_CLIENT_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID.test(candidate)
  ) {
    return candidate;
  }
  return randomUUID();
}

/**
 * Attache un identifiant de corrélation à chaque requête (UF-607).
 *
 * Trois effets, dans cet ordre :
 * 1. l'identifiant est renvoyé au client dans `X-Request-Id` — la PWA peut
 *    l'afficher dans son écran d'erreur ;
 * 2. il est publié dans le contexte de requête, donc repris automatiquement par
 *    chaque ligne de journal émise sous ce traitement ;
 * 3. le filtre d'exceptions global l'ajoute au corps des réponses d'erreur.
 *
 * C'est le fil qui relie « l'usager a vu une erreur » à « voici la trace
 * serveur » sans transporter la moindre donnée personnelle (C11).
 *
 * Écrit comme un middleware Express nu, branché dans `main.ts` avant tout le
 * reste : il doit envelopper l'exécution de **toutes** les couches suivantes
 * (guards, contrôleurs, filtre d'exceptions) pour que leurs journaux héritent
 * du contexte. Un middleware NestJS déclaré par `configure()` serait posé plus
 * tard dans la chaîne, et il n'a ici rien à injecter.
 */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);

  // Réécrit l'en-tête entrant : les couches suivantes lisent ainsi la valeur
  // retenue, et non celle — potentiellement rejetée — qu'a envoyée le client.
  request.headers[REQUEST_ID_HEADER] = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  runWithRequestContext({ requestId }, () => {
    next();
  });
}
