import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Filtre d'exceptions global : normalise toutes les réponses d'erreur de l'API.
 *
 * - Les erreurs HTTP connues (HttpException) conservent leur statut et message.
 * - Toute erreur inattendue devient un 500 générique : aucun détail interne
 *   (stack, requête SQL...) ne fuit vers le client (C4).
 * - La journalisation ne contient AUCUNE donnée personnelle : uniquement
 *   méthode, chemin et statut — jamais le corps de la requête ni les
 *   coordonnées de déplacement (C11).
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

    // C11 : log technique sans données personnelles (pas de body, pas de coordonnées)
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.path} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.path} -> ${status}`);
    }

    response
      .status(status)
      .json(
        typeof body === 'string'
          ? { statusCode: status, message: body, timestamp: new Date().toISOString() }
          : { ...body, timestamp: new Date().toISOString() },
      );
  }
}
