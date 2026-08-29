import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { getRequestId } from '../logging/request-context';

/**
 * Filtre d'exceptions global : normalise toutes les réponses d'erreur de l'API.
 *
 * - Les erreurs HTTP connues (HttpException) conservent leur statut et message.
 * - Toute erreur inattendue devient un 500 générique : aucun détail interne
 *   (stack, requête SQL...) ne fuit vers le client (C4).
 * - La journalisation ne contient AUCUNE donnée personnelle : uniquement
 *   méthode, chemin et statut — jamais le corps de la requête ni les
 *   coordonnées de déplacement (C11).
 * - Chaque réponse d'erreur porte le `requestId` de la requête (UF-607) : c'est
 *   la seule information que l'usager peut recopier dans un signalement de
 *   bogue pour qu'on retrouve la trace serveur correspondante. Elle est
 *   volontairement opaque — un identifiant tiré au sort ne dit rien de notre
 *   topologie ni de l'incident (C11), il sert seulement de clé de jointure.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: 'Internal server error' };

    const requestId = getRequestId();

    // C11 : log technique sans données personnelles (pas de body, pas de coordonnées).
    // Le `requestId` n'est pas répété dans le message : le journal structuré le
    // porte déjà comme champ propre (UF-607), et un champ se filtre, pas une
    // sous-chaîne de phrase.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.path} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.path} -> ${status}`);
    }

    const envelope = typeof body === 'string' ? { statusCode: status, message: body } : { ...body };

    response.status(status).json({
      ...envelope,
      timestamp: new Date().toISOString(),
      ...(requestId === undefined ? {} : { requestId }),
    });
  }
}
