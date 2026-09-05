import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { SimulateTripDto } from './dto/simulate-trip.dto';
import { TripSimulationDto } from './dto/trip-simulation.dto';
import { SimulationService } from './simulation.service';

/**
 * Contrôleur du mode simulation de trajet (UF-701) — **réservé au rôle
 * `admin`**, et le seul de l'API à l'être.
 *
 * ## Pourquoi une réservation, et pas une fonctionnalité ouverte
 *
 * Simuler un déplacement, c'est le faire compter comme réalisé : le guidage
 * consomme les positions fictives comme des mesures GPS, atteint la
 * destination, et le trajet entre dans le suivi carbone personnel (UF-807).
 * Offrir cela à tout le monde reviendrait à laisser chacun se composer un
 * bilan — exactement ce qu'UF-505 refuse en n'acceptant aucun gramme venu du
 * navigateur. Un bilan qu'on peut se fabriquer ne vaut plus rien, même quand
 * la seule personne trompée est son auteur.
 *
 * L'outil garde pourtant sa raison d'être : sans lui, le parcours complet
 * — planifier, partir, arriver, voir l'empreinte se cumuler — n'est
 * démontrable qu'en marchant réellement de la Part-Dieu à Bellecour.
 *
 * ## Les trois réponses, et leur sens
 *
 * | Appel                                | Réponse |
 * | ------------------------------------ | ------- |
 * | Sans jeton, ou jeton invalide/expiré | `401`   |
 * | Compte `user` authentifié            | `403`   |
 * | Compte `admin` authentifié           | `200`   |
 *
 * Le `403` est rendu par le `RolesGuard`, qui relit le rôle **en base** — pas
 * dans le jeton. Un compte rétrogradé perd l'accès à l'appel suivant, sans
 * attendre l'expiration de sa session (C4 / OWASP A01).
 *
 * ## Côté interface
 *
 * Le bouton « Simuler le déplacement » n'est peint que pour un exploitant.
 * C'est du confort, pas de la sécurité : la frontière est ici, dans ce guard,
 * et elle tient qu'on passe par l'écran, par Swagger ou par `curl`.
 */
@ApiTags('simulation')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@Controller('simulation')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  /**
   * Produit la trace d'un trajet : les positions fictives à rejouer.
   *
   * **Une seule requête pour toute la démonstration** (C5) : le client reçoit
   * la trace entière et l'anime lui-même, il ne redemande rien à chaque pas.
   * C'est le même parti pris que le guidage réel, qui n'émet aucune requête du
   * départ à l'arrivée.
   *
   * L'appel ne lit ni n'écrit rien en base : il ne consigne pas de trajet, ne
   * touche pas à l'historique et ne laisse aucune trace du déplacement simulé
   * (C8). Ce qui sera éventuellement consigné le sera par le chemin normal, à
   * l'arrivée du guidage (UF-807) — comme pour un trajet réel.
   */
  @Roles(UserRole.ADMIN)
  @Post('trip')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trace de simulation d’un trajet (outil interne — rôle admin)',
    description:
      'Corps : les segments de l’itinéraire retenu (durée + tracé), **sans `userId`** — le ' +
      'demandeur est le porteur du JWT (C4). Répond une trentaine de positions fictives ' +
      'réparties sur le **temps** du trajet, à rejouer toutes les deux secondes. Le guidage ' +
      'les consomme comme des mesures GPS : même progression, même détection d’arrivée, donc ' +
      'même entrée dans le suivi carbone (UF-807). Réservé au rôle `admin` : simuler un ' +
      'déplacement, c’est le faire compter, et un bilan qu’on peut se fabriquer ne vaut plus rien.',
  })
  @ApiOkResponse({
    type: TripSimulationDto,
    description:
      'Trace complète. Le dernier pas tombe exactement sur le dernier point du tracé, ce qui ' +
      'fait franchir au guidage son rayon d’arrivée.',
  })
  @ApiUnauthorizedResponse({ description: 'Jeton absent, invalide ou expiré.' })
  @ApiForbiddenResponse({
    description:
      'Compte authentifié mais sans le rôle `admin`. Volontairement `403` et non `401` : ' +
      'renvoyer un usager connecté vers l’écran de connexion ne lui donnerait rien de plus.',
  })
  @ApiBadRequestResponse({
    description:
      'Corps invalide (coordonnées hors domaine WGS84, listes hors bornes), ou itinéraire dont ' +
      'aucun segment ne porte de tracé exploitable — il n’y aurait rien à montrer sur la carte.',
  })
  simulate(@Body() dto: SimulateTripDto): TripSimulationDto {
    return this.simulationService.simulate(dto);
  }
}
