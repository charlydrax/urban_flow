import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { NearbyStationsQueryDto, NearbyStationsResponseDto } from './dto/nearby-stations.dto';
import { SharedMobilityService } from './shared-mobility.service';
import { TransportService, TransportSourceStatus } from './transport.service';

/**
 * Contrôleur des intégrations transport (F3).
 *
 * Deux routes, deux consommateurs : l'état des sources GTFS/GBFS, qui écrit la
 * ligne de provenance des encarts temps réel de l'écran de résultats (C9, C10),
 * et les stations de véhicules en libre-service autour d'un point (UF-303), qui
 * alimente l'encart « station » du même écran.
 *
 * ## Les deux sont ouvertes aux visiteurs (UF-804)
 *
 * Authentification **facultative**, pour la même raison qui a ouvert
 * `POST /routes/plan` (UF-801) : elles rendent une donnée publique — l'état de
 * nos sources et le nombre de vélos à une borne — identique pour tout le monde,
 * et elles alimentent un écran lui-même accessible sans compte. Les laisser sous
 * le régime par défaut aurait donné un écran à deux vitesses : le visiteur aurait
 * vu ses itinéraires, et deux cartes en erreur 401 sous elles.
 *
 * `@OptionalAuth()` plutôt que `@Public()` : un jeton périmé doit rester un
 * `401`, sans quoi une session morte deviendrait une visite anonyme en silence
 * (voir la docstring du décorateur).
 *
 * ## Ce contrôleur n'expose plus les pistes cyclables (depuis UF-808)
 *
 * `GET /transport/cycle-paths/nearby` (UF-304) est retiré. Aucun écran ne l'a
 * jamais appelé : UF-804 l'avait conservé comme pièce de recette et de
 * démonstration `ST_DWithin`, ce que le ticket #97 solde — une route qui
 * n'a pas d'appelant n'a pas non plus de gardien, et c'est de la surface
 * d'attaque qu'on n'a aucune raison de surveiller (C4).
 *
 * Le `CyclePathsService`, lui, **reste** et n'a rien perdu : il est appelé à
 * chaque planification, en troisième branche du `Promise.all` de la collecte
 * (UF-305). C'est l'endpoint HTTP qui disparaît, pas la fonctionnalité — et
 * `ST_DWithin` se démontre désormais par le planificateur, ou par l'`EXPLAIN`
 * documenté dans `docs/cycle-paths-postgis.md`.
 */
@ApiTags('transport')
@ApiBearerAuth()
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée.' })
@Controller('transport')
export class TransportController {
  constructor(
    private readonly transportService: TransportService,
    private readonly sharedMobilityService: SharedMobilityService,
  ) {}

  /**
   * État des sources de données transport.
   * Les deux sources sont réellement sondées depuis UF-303.
   */
  @OptionalAuth()
  @Get('status')
  @ApiOperation({
    summary: 'État des sources GTFS/GBFS',
    description:
      'La source `gtfs` interroge le moteur OpenTripPlanner auto-hébergé et rapporte la ' +
      'période couverte par le GTFS chargé. La source `gbfs` relit le flux temps réel de ' +
      "l'opérateur de vélos en libre-service et rapporte sa fraîcheur. Une source qui ne " +
      'répond pas passe à `down` : le planificateur continue alors sans ce mode (C10).',
  })
  @ApiOkResponse({ description: 'Statut de chaque source de données transport.' })
  getStatus(): Promise<TransportSourceStatus[]> {
    return this.transportService.getStatus();
  }

  /**
   * Stations de vélos/trottinettes en libre-service autour d'un point (UF-303).
   *
   * Étapes 10-11 du flux de référence : le Service Itinéraire s'en sert pour
   * proposer un rabattement en mobilité douce vers ou depuis un arrêt.
   *
   * `200 OK` même quand l'opérateur est injoignable — le corps porte alors
   * `status: 'unavailable'`. Renvoyer une erreur HTTP ferait croire au client
   * que *sa* requête est fautive, alors que c'est une source amont qui manque
   * (C10).
   */
  @OptionalAuth()
  @Get('stations/nearby')
  @ApiOperation({
    summary: 'Stations de véhicules en libre-service à proximité',
    description:
      'Retourne les stations du rayon demandé, triées par distance croissante, avec le ' +
      "nombre de véhicules disponibles en temps réel. Le champ `publishedAt` porte l'heure " +
      "de publication du flux par l'opérateur : c'est la fraîcheur de la donnée, pas celle " +
      'de la réponse. Une indisponibilité du flux se lit dans `status`, pas dans le code HTTP.',
  })
  @ApiOkResponse({ type: NearbyStationsResponseDto })
  @ApiBadRequestResponse({
    description: 'Coordonnées manquantes ou hors bornes WGS84, rayon ou limite hors plage (C4).',
  })
  getNearbyStations(@Query() query: NearbyStationsQueryDto): Promise<NearbyStationsResponseDto> {
    return this.sharedMobilityService.getNearbyStations(
      { label: 'Point de recherche', lat: query.lat, lng: query.lng },
      { radiusMeters: query.radius, limit: query.limit },
    );
  }
}
