import { Body, Controller, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { ThrottleClientErrors } from '../../common/throttling';

import { ReportClientErrorDto } from './dto/report-client-error.dto';

/**
 * Collecte des erreurs survenues **dans le navigateur** (UF-607).
 *
 * Pourquoi un endpoint plutôt qu'un service tiers (Sentry & co.) : la
 * plateforme traite des données de déplacement, et envoyer les erreurs d'un
 * usager chez un sous-traitant hors périmètre demanderait une base légale, une
 * mention au registre et un transfert documenté (C8). Pour le volume d'un MVP,
 * une ligne dans le journal structuré de l'API suffit et reste chez nous
 * (C11) : back et front écrivent dans le **même flux**, corrélés par
 * `requestId`.
 */
@ApiTags('diagnostics')
@Controller('diagnostics')
export class DiagnosticsController {
  private readonly logger = new Logger('ClientError');

  /**
   * Enregistre un signalement d'erreur émis par la PWA.
   *
   * `@Public()` : une session expirée ou un plantage de l'écran de connexion
   * sont précisément les cas qu'on veut voir. Exiger un JWT reviendrait à
   * n'observer que les pannes des usagers connectés — c'est-à-dire à être
   * aveugle là où ça casse le plus. En contrepartie, l'endpoint est
   * strictement plafonné (voir `ThrottleClientErrors`) et n'écrit rien en base
   * : il ne peut ni saturer le stockage, ni servir de canal d'exfiltration.
   *
   * Répond `204` : le navigateur n'a rien à faire du résultat, et une réponse
   * vide évite qu'un écran d'erreur ait à gérer l'erreur de son propre
   * signalement.
   */
  @Public()
  @ThrottleClientErrors()
  @Post('client-errors')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Signale une erreur survenue dans l'interface (PWA)" })
  @ApiBody({ type: ReportClientErrorDto })
  @ApiNoContentResponse({ description: 'Signalement journalisé.' })
  report(@Body() dto: ReportClientErrorDto): void {
    // Un seul message, à plat : le journal structuré ajoute déjà l'horodatage,
    // le contexte (`ClientError`) et le `requestId` de CE signalement. Celui du
    // champ `requestId` est écrit dans le message parce qu'il désigne une AUTRE
    // requête — celle qui a échoué — et qu'on veut pouvoir la retrouver.
    this.logger.warn(
      [
        `screen=${dto.screen}`,
        `name=${dto.name ?? 'Error'}`,
        dto.requestId === undefined ? undefined : `apiRequestId=${dto.requestId}`,
        dto.digest === undefined ? undefined : `digest=${dto.digest}`,
        `message=${dto.message}`,
      ]
        .filter((part) => part !== undefined)
        .join(' '),
    );
  }
}
