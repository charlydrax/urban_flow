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

import { CyclePathsService } from './cycle-paths/cycle-paths.service';
import { CycleSegmentsQueryDto, CycleSegmentsResponseDto } from './dto/cycle-segments.dto';
import { NearbyStationsQueryDto, NearbyStationsResponseDto } from './dto/nearby-stations.dto';
import { SharedMobilityService } from './shared-mobility.service';
import { TransportService, TransportSourceStatus } from './transport.service';

/**
 * Contrôleur des intégrations transport (F3).
 * Expose l'état des sources GTFS/GBFS pour le diagnostic et l'affichage
 * d'un mode dégradé côté client (C10), les stations de véhicules en
 * libre-service à proximité d'un point (UF-303), et les tronçons cyclables
 * issus de notre propre base PostGIS (UF-304).
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
    private readonly cyclePathsService: CyclePathsService,
  ) {}

  /**
   * État des sources de données transport.
   * Les deux sources sont réellement sondées depuis UF-303.
   */
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

  /**
   * Tronçons cyclables et piétons autour d'un point (UF-304).
   *
   * Étapes 12-13 du flux de référence : la troisième branche du `Promise.all`
   * du Service Itinéraire, celle qui vient de **notre** base PostGIS et non
   * d'une source externe.
   *
   * Pas de `status` dans la réponse, à la différence des deux autres sources :
   * si PostGIS ne répond pas, le JWT n'a pas pu être vérifié non plus. Il n'y a
   * rien à dégrader gracieusement — l'erreur doit remonter en `500`.
   */
  @Get('cycle-paths/nearby')
  @ApiOperation({
    summary: 'Tronçons cyclables et piétons à proximité',
    description:
      'Interroge PostGIS (`ST_DWithin` sur index GiST) et retourne les aménagements cyclables ' +
      'du rayon demandé, triés par distance croissante, tracé GeoJSON compris. La distance est ' +
      'celle du **point le plus proche du tronçon** : une piste de deux kilomètres qui longe le ' +
      'point demandé est à quelques mètres, pas à mille. `datasetImportedAt` date le jeu de ' +
      "données — `null` signifie que l'import n'a pas encore été lancé.",
  })
  @ApiOkResponse({ type: CycleSegmentsResponseDto })
  @ApiBadRequestResponse({
    description: 'Coordonnées manquantes ou hors bornes WGS84, rayon ou limite hors plage (C4).',
  })
  getNearbyCycleSegments(@Query() query: CycleSegmentsQueryDto): Promise<CycleSegmentsResponseDto> {
    return this.cyclePathsService.getCycleSegments(
      { label: 'Point de recherche', lat: query.lat, lng: query.lng },
      { radiusMeters: query.radius, limit: query.limit },
    );
  }
}
