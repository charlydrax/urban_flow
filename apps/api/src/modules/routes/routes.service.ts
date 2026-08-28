import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { CarbonService } from '../carbon/carbon.service';
import { SearchHistoryService } from '../search-history/search-history.service';
import { UsersService } from '../users/users.service';
import { ItineraryDto, PlanRoutesResponseDto } from './dto/itinerary.dto';
import { PlaceDto, PlanRouteDto } from './dto/plan-route.dto';
import { mergeIntoItineraries, type MergeEndpoint } from './merge/itinerary-merger';
import { SourceCollectorService } from './sources/source-collector.service';

/**
 * Service Itinéraire (F2) — cœur du flux de référence (CLAUDE.md section 4).
 *
 * État d'avancement :
 * 1. ✅ Lecture des préférences profil (PostGIS) — étape 3.
 * 2. ✅ Appels PARALLÈLES aux trois sources GTFS / GBFS / PostGIS via
 *    `Promise.allSettled`, avec dégradation gracieuse — étapes 13-18, UF-305, C10.
 * 3. ✅ Fusion en itinéraires multimodaux réels — étape 5, UF-401.
 * 4. ✅ `computeFootprint(segments)` du Service Carbone par itinéraire — étape 6.
 * 5. ✅ Sauvegarde `search_history` — étapes 7 et 18, UF-402.
 *
 * Depuis UF-401, **plus aucun itinéraire n'est simulé** : chaque proposition est
 * construite à partir des données réellement collectées (trajets OTP, bornes
 * Vélo'v disponibles, tronçons cyclables PostGIS). Une liste vide signifie donc
 * qu'aucune combinaison n'a pu être formée, et le champ `sources` dit si c'est
 * faute de données ou faute d'options.
 *
 * ## Répartition des rôles
 *
 * Ce service **orchestre** ; il ne calcule pas. La fusion vit dans une fonction
 * pure (`merge/itinerary-merger.ts`), le barème carbone dans le Service Carbone.
 * C'est ce qui permet de tester l'algorithme multimodal sans base, sans OTP et
 * sans conteneur d'injection — et de le présenter isolément en soutenance.
 *
 * Couvre : F2, C4 (identité du JWT, entrées validées), C9 (GeoJSON),
 * C10 (appels parallèles, dégradation gracieuse), C12 (préférence PMR).
 */
@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private readonly users: UsersService,
    private readonly collector: SourceCollectorService,
    private readonly carbon: CarbonService,
    private readonly searchHistory: SearchHistoryService,
  ) {}

  /**
   * Calcule les itinéraires multimodaux entre deux lieux.
   *
   * Les préférences sont lues **avant** la collecte et non en parallèle d'elle :
   * elles en sont une entrée (la préférence PMR change la requête envoyée à
   * OpenTripPlanner — C12). Les paralléliser reviendrait à interroger le moteur
   * avant de savoir quoi lui demander.
   *
   * Une panne de la base à cette étape n'est **pas** dégradée : sans profil, on
   * ne sait pas quels itinéraires l'usager accepte, et en inventer serait pire
   * que d'échouer. La dégradation gracieuse commence à la collecte.
   *
   * @param dto Requête validée `{ from, to }` — sans `userId` depuis UF-402 (C4)
   * @param userId Identité issue du JWT vérifié : seule source de l'identité (anti-IDOR, C4)
   * @returns Les itinéraires retenus, la clé de tri, l'état des trois sources et la ligne d'historique
   * @throws {BadRequestException} si une extrémité n'a pas de coordonnées
   */
  async plan(dto: PlanRouteDto, userId: string): Promise<PlanRoutesResponseDto> {
    const from = toEndpoint(dto.from, 'départ');
    const to = toEndpoint(dto.to, 'arrivée');

    // Étape 3 du flux : les préférences viennent du compte du JWT, jamais du
    // corps de la requête (anti-IDOR — C4).
    const preferences = await this.users.getPreferences(userId);

    // Étape 18 : la recherche est enregistrée dès sa soumission, en même temps
    // que la collecte démarre. Deux raisons de ne pas attendre le résultat :
    // l'historique décrit ce que l'usager a *cherché*, pas ce que nos sources
    // ont su répondre — un trajet reste à mémoriser même quand les trois se
    // taisent ; et son insertion se paie ainsi sous la latence de la source la
    // plus lente, au lieu de s'y ajouter (C5).
    const recording = this.rememberSearch(userId, from, to);

    // Étapes 13-18 : les trois sources en parallèle (UF-305).
    const collected = await this.collector.collectAllSources(from, to, {
      reducedMobility: preferences.reducedMobility,
    });

    if (collected.allSourcesFailed) {
      // Aucune exception : les trois sources muettes restent une réponse
      // valide, avec une liste vide et un `sources` qui dit pourquoi. Un 500
      // ferait croire à un défaut de la requête de l'usager (C10).
      //
      // La fusion n'est même pas tentée : sans aucune donnée, seule la marche
      // seule pourrait être proposée, et la proposer ici laisserait croire que
      // le planificateur a fonctionné alors qu'il n'a rien reçu.
      this.logger.warn('Aucune source disponible : réponse sans itinéraire.');
      return {
        itineraries: [],
        sortedBy: 'carbonAsc',
        sources: this.collector.toAvailability(collected),
        searchHistoryId: await recording,
      };
    }

    // Étape 5 du flux : la fusion (UF-401). Fonction pure — elle ne connaît que
    // ce que la collecte a rapporté, et ne peut donc rien inventer.
    const { itineraries, sortedBy } = mergeIntoItineraries(collected, from, to, preferences);

    // Étape 6 : l'empreinte publiée est celle du Service Carbone, qui reste
    // l'autorité sur le barème. La fusion a estimé la même valeur pour classer
    // ses candidats ; on la lui fait confirmer plutôt que de la croire sur
    // parole — le jour où le barème s'affinera (facteurs ADEME détaillés), ce
    // seul appel suffira à propager le changement.
    //
    // Depuis UF-501, ce même appel rend le **détail** par segment. Les
    // `carbonGrams` des segments sont réécrits avec ses lignes plutôt que
    // laissés tels que la fusion les a posés : deux chiffres pour la même chose
    // à l'écran, l'un du service et l'autre de la fusion, finiraient un jour par
    // ne plus coïncider — et c'est le service qui a raison, par construction.
    const priced: ItineraryDto[] = itineraries.map((itinerary) => {
      const footprint = this.carbon.computeFootprint(itinerary.segments);

      return {
        ...itinerary,
        carbonGrams: footprint.totalGrams,
        carbon: footprint,
        segments: itinerary.segments.map((segment, index) => ({
          ...segment,
          carbonGrams: footprint.segments[index]?.grams ?? segment.carbonGrams,
        })),
      };
    });

    this.logger.log(
      `Fusion : ${priced.length} itinéraire(s) retenu(s), triés par ${sortedBy} ` +
        `(${3 - collected.failures.length}/3 source(s) disponible(s)).`,
    );

    return {
      itineraries: priced,
      sortedBy,
      sources: this.collector.toAvailability(collected),
      searchHistoryId: await recording,
    };
  }

  /**
   * Écrit la recherche dans `search_history` (UF-204) pour le compte du JWT.
   *
   * **Ni `selectedSummary` ni `carbonGrams`.** À l'étape 18, aucune option n'a
   * encore été retenue : inscrire d'office la première proposition ferait
   * passer un classement du serveur pour un choix de l'usager, et fausserait le
   * tableau de bord carbone du Sprint 5 — qui doit compter des déplacements,
   * pas des suggestions. C'est l'écran de résultats (UF-404) qui saura ce qui a
   * été choisi.
   *
   * **Un échec ne remonte jamais.** Ne pas mémoriser un trajet est un
   * désagrément ; perdre à cause de cela des itinéraires déjà calculés serait
   * une régression fonctionnelle (dégradation gracieuse — C10). Le client
   * reçoit `searchHistoryId: null`, et le serveur garde la cause dans ses logs.
   *
   * C11 : le journal ne porte ni libellé ni coordonnées — l'incident se
   * diagnostique sans exposer le déplacement de l'usager.
   *
   * @returns L'identifiant de la ligne créée, ou `null` si l'écriture a échoué
   */
  private async rememberSearch(
    userId: string,
    from: MergeEndpoint,
    to: MergeEndpoint,
  ): Promise<string | null> {
    try {
      const entry = await this.searchHistory.create(userId, { from, to });
      return entry.id;
    } catch (error) {
      this.logger.warn(`Recherche non enregistrée dans l'historique : ${(error as Error).message}`);
      return null;
    }
  }
}

/**
 * Exige des coordonnées sur une extrémité de trajet.
 *
 * Le DTO les accepte facultatives (le contrat du diagramme autorise une saisie
 * purement textuelle), mais les trois sources travaillent sur des points : sans
 * coordonnées, il n'y a rien à interroger. Le géocodage est fait en amont, côté
 * client (UF-203) — un label seul est donc un défaut d'appel, pas une panne, et
 * mérite un `400` explicite plutôt qu'une liste vide inexplicable.
 */
function toEndpoint(place: PlaceDto, role: string): MergeEndpoint {
  if (typeof place.lat !== 'number' || typeof place.lng !== 'number') {
    throw new BadRequestException(
      `Le point de ${role} doit porter des coordonnées (lat, lng) : le géocodage est fait par le client.`,
    );
  }
  return { label: place.label, lat: place.lat, lng: place.lng };
}
