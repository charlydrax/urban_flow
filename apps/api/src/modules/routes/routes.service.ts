import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  MIN_TRAVELLERS,
  TransportMode,
  type AppliedRouteConstraints,
  type ItinerarySortKey,
} from '@urbanflow/shared';

import { CarbonService } from '../carbon/carbon.service';
import { SearchHistoryService } from '../search-history/search-history.service';
import { StreetRoutingService } from '../transport/street-routing.service';
import { DEFAULT_PREFERENCES, UsersService } from '../users/users.service';
import { ItineraryDto, PlanRoutesResponseDto } from './dto/itinerary.dto';
import { PlaceDto, PlanRouteDto } from './dto/plan-route.dto';
import { comparatorFor, mergeIntoItineraries, type MergeEndpoint } from './merge/itinerary-merger';
import { applyStreetGeometry, collectStreetPathQueries } from './merge/street-geometry';
import { SourceCollectorService } from './sources/source-collector.service';

/**
 * Service Itinéraire (F2) — cœur du flux de référence (CLAUDE.md section 4).
 *
 * État d'avancement :
 * 1. ✅ Lecture des préférences profil (PostGIS) — étape 3.
 * 2. ✅ Appels PARALLÈLES aux trois sources GTFS / GBFS / PostGIS via
 *    `Promise.allSettled`, avec dégradation gracieuse — étapes 13-18, UF-305, C10.
 * 3. ✅ Fusion en itinéraires multimodaux réels — étape 5, UF-401.
 * 4. ✅ `computeFootprint(segments)` du Service Carbone par itinéraire, puis
 *    reclassement sur l'empreinte publiée — étapes 6 et 16-17, UF-502.
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
    private readonly streetRouting: StreetRoutingService,
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
   * ## Visiteur non connecté (UF-801)
   *
   * `userId` vaut `null`. Deux conséquences, et deux seulement : les
   * préférences appliquées sont `DEFAULT_PREFERENCES` — sans requête en base,
   * puisqu'il n'y a pas de profil à lire —, et la recherche n'est pas
   * mémorisée (`searchHistoryId: null`). Tout le reste — collecte, fusion,
   * barème carbone, tri — est identique : un invité n'a pas droit à un
   * planificateur au rabais, il a droit au même sans la personnalisation qu'il
   * n'a pas demandée.
   *
   * Écrire un historique pour un anonyme n'aurait d'ailleurs aucun destinataire
   * (aucun écran ne pourrait le relire) et constituerait une collecte sans
   * finalité — donc sans base légale (minimisation, C8).
   *
   * @param dto Requête validée `{ from, to }` — sans `userId` depuis UF-402 (C4)
   * @param userId Identité issue du JWT vérifié : seule source de l'identité
   * (anti-IDOR, C4), ou `null` pour un visiteur non connecté (UF-801)
   * @returns Les itinéraires retenus, la clé de tri, l'état des trois sources et la ligne d'historique
   * @throws {BadRequestException} si une extrémité n'a pas de coordonnées
   */
  async plan(dto: PlanRouteDto, userId: string | null): Promise<PlanRoutesResponseDto> {
    const from = toEndpoint(dto.from, 'départ');
    const to = toEndpoint(dto.to, 'arrivée');

    // Étape 3 du flux : les préférences viennent du compte du JWT, jamais du
    // corps de la requête (anti-IDOR — C4). Sans compte, les défauts, et
    // surtout **aucune requête en base** : interroger PostGIS avec un
    // identifiant nul rendrait de toute façon ces mêmes défauts, en payant un
    // aller-retour pour l'apprendre (C5).
    // La copie n'est pas décorative : `DEFAULT_PREFERENCES` est un objet de
    // module, partagé par tous les appels. `getPreferences` en rend déjà une
    // copie ; rendre ici la référence ferait de ce chemin le seul par lequel
    // un défaut global pourrait être modifié.
    const preferences = userId
      ? await this.users.getPreferences(userId)
      : { ...DEFAULT_PREFERENCES, preferredModes: [...DEFAULT_PREFERENCES.preferredModes] };

    // UF-804 : la chip « voyageurs » et le sélecteur de modes de l'écran. Ce
    // sont des contraintes **de la requête**, pas du profil : elles ne sont
    // donc pas fusionnées dans `preferences`, qui décrit un compte, mais
    // passées à côté. Un groupe de un et une sélection absente rendent
    // exactement le comportement d'avant le ticket.
    const travellers = dto.travellers ?? MIN_TRAVELLERS;
    const selectedModes = dto.modes;

    // Publié dans les deux sorties de la méthode (UF-602, étendu par UF-804) :
    // que la liste soit pleine, courte ou vide, le client doit pouvoir dire
    // *pourquoi* — un filtre PMR actif, un mode décoché ou un groupe de quatre
    // changent tous la lecture d'un « aucun itinéraire » (C7/C12).
    const appliedConstraints = describeConstraints(
      preferences.reducedMobility,
      selectedModes,
      travellers,
    );

    // Étape 18 : la recherche est enregistrée dès sa soumission, en même temps
    // que la collecte démarre. Deux raisons de ne pas attendre le résultat :
    // l'historique décrit ce que l'usager a *cherché*, pas ce que nos sources
    // ont su répondre — un trajet reste à mémoriser même quand les trois se
    // taisent ; et son insertion se paie ainsi sous la latence de la source la
    // plus lente, au lieu de s'y ajouter (C5).
    const recording = userId ? this.rememberSearch(userId, from, to) : Promise.resolve(null);

    // Étapes 13-18 : les trois sources en parallèle (UF-305).
    const collected = await this.collector.collectAllSources(from, to, {
      reducedMobility: preferences.reducedMobility,
      ...(dto.departAt ? { departureAt: dto.departAt } : {}),
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
        appliedConstraints,
        searchHistoryId: await recording,
      };
    }

    // Étape 5 du flux : la fusion (UF-401). Fonction pure — elle ne connaît que
    // ce que la collecte a rapporté, et ne peut donc rien inventer.
    const { itineraries, sortedBy } = mergeIntoItineraries(collected, from, to, {
      ...preferences,
      travellers,
      ...(selectedModes ? { selectedModes } : {}),
    });

    // UF-702 : les segments marche et vélo sortent de la fusion en ligne
    // droite — elle les synthétise, elle ne les route pas. On demande ici leur
    // cheminement réel au moteur, une fois la liste arrêtée : au plus cinq
    // itinéraires, dont les marches se répètent et se dédupliquent (C5).
    const traced = await this.traceStreetSegments(
      itineraries,
      preferences.reducedMobility,
      collected.transit.status === 'ok',
    );

    // Étapes 16-17 du flux (UF-502) : la valorisation carbone de la liste
    // fusionnée. Mesurée, parce que le ticket exige que le calcul « ne rallonge
    // pas notablement la réponse » — une exigence qu'on ne tient pas en
    // l'affirmant. La durée est journalisée à côté de celle de la collecte,
    // pour que les deux se comparent au même endroit (C10).
    const carbonStartedAt = performance.now();
    const priced = this.priceItineraries(traced, sortedBy);
    const carbonElapsedMs = performance.now() - carbonStartedAt;

    this.logger.log(
      `Fusion : ${priced.length} itinéraire(s) retenu(s), triés par ${sortedBy} ` +
        `(${3 - collected.failures.length}/3 source(s) disponible(s)) — ` +
        `carbone ${carbonElapsedMs.toFixed(1)} ms sur ${collected.elapsedMs} ms de collecte.`,
    );

    return {
      itineraries: priced,
      sortedBy,
      sources: this.collector.toAvailability(collected),
      appliedConstraints,
      searchHistoryId: await recording,
    };
  }

  /**
   * Remplace les droites des segments marche et vélo par leur cheminement réel
   * (UF-702), quand le moteur de routage est en mesure de le fournir.
   *
   * ## Pourquoi c'est conditionné à l'état de la source TC
   *
   * Le routeur de voirie et le connecteur GTFS interrogent **le même**
   * OpenTripPlanner. Si la collecte vient d'établir qu'il ne répond pas, lui
   * redemander cinq cheminements ne rendrait rien et coûterait le budget entier
   * à chaque recherche — exactement la latence que C10 interdit d'ajouter, et
   * l'état de la production tant qu'OTP n'y est pas déployé (BUG-002). On
   * s'abstient donc, et tous les segments restent marqués `straight` : le
   * client l'annonce, la carte reste juste sur ce qu'elle montre.
   *
   * ## Ce que coûte l'étape quand elle a lieu
   *
   * Un aller-retour, en parallèle et sous budget (voir `StreetRoutingService`).
   * Elle ne peut pas échouer : le service ne lève jamais, et un cheminement
   * manquant laisse simplement sa droite au segment.
   *
   * @param itineraries Itinéraires issus de la fusion
   * @param wheelchair Exigence PMR du profil — elle change le cheminement
   *   piéton demandé (C12)
   * @param engineReachable `false` quand la collecte a conclu qu'OTP ne répond pas
   * @returns Les mêmes itinéraires, tracés au réseau réel là où c'était possible
   */
  private async traceStreetSegments(
    itineraries: readonly ItineraryDto[],
    wheelchair: boolean,
    engineReachable: boolean,
  ): Promise<ItineraryDto[]> {
    if (!engineReachable) {
      this.logger.debug(
        'Moteur de routage indisponible : les segments marche et vélo gardent leur tracé à vol ' +
          "d'oiseau (UF-702).",
      );
      return [...itineraries];
    }

    const queries = collectStreetPathQueries(itineraries, wheelchair);
    if (queries.length === 0) return [...itineraries];

    const startedAt = performance.now();
    const paths = await this.streetRouting.routePaths(queries);
    this.logger.log(
      `Tracés de voirie : ${paths.size} cheminement(s) pour ${queries.length} segment(s) ` +
        `en ${(performance.now() - startedAt).toFixed(1)} ms.`,
    );

    return applyStreetGeometry(itineraries, paths, wheelchair);
  }

  /**
   * Étape 6 puis 16-17 du flux : valorise chaque itinéraire au barème du
   * Service Carbone, puis **reclasse** la liste sur les valeurs ainsi publiées
   * (UF-502).
   *
   * ## Pourquoi le service, et pas la fusion
   *
   * La fusion a déjà estimé une empreinte pour classer ses candidats. On la
   * fait confirmer plutôt que de la croire sur parole : le Service Carbone est
   * l'autorité sur le barème, et le jour où celui-ci s'affinera (taux
   * d'occupation réels, mix électrique, VAE), ce seul appel suffira à propager
   * le changement jusqu'à la réponse.
   *
   * Depuis UF-501 il rend aussi le **détail** par segment. Les `carbonGrams`
   * des segments sont donc réécrits avec ses lignes plutôt que laissés tels que
   * la fusion les a posés : deux chiffres pour la même chose à l'écran, l'un du
   * service et l'autre de la fusion, finiraient un jour par ne plus coïncider.
   *
   * ## Pourquoi reclasser
   *
   * `sortedBy` est une **promesse faite au client** : il annonce « classés par
   * empreinte » sans revérifier. Or l'ordre venait jusqu'ici de l'estimation de
   * la fusion, tandis que les nombres affichés viennent du service. Les deux
   * coïncident aujourd'hui — même barème, même fonction — mais c'est
   * précisément ce qu'on vient de se réserver le droit de changer. Le jour où
   * le barème s'affinera d'un côté seulement, la liste resterait étiquetée
   * `carbonAsc` en étant visiblement mal triée, et le défaut se verrait
   * d'abord à l'écran de l'usager.
   *
   * Reclasser ici referme l'écart par construction : l'ordre publié est trié
   * sur les valeurs publiées, quelles qu'elles deviennent. Le coût est nul à
   * l'échelle en jeu — au plus cinq itinéraires (`MAX_ITINERARIES`).
   *
   * Le comparateur est celui de la fusion, importé et non réécrit : deux règles
   * de départage divergentes feraient changer l'ordre pour une raison
   * étrangère au carbone.
   *
   * @param itineraries Propositions issues de la fusion, dans son propre ordre
   * @param sortedBy Clé de tri déduite du profil, celle que la réponse annonce
   * @returns Les mêmes propositions, valorisées et classées sur ces valeurs
   */
  private priceItineraries(
    itineraries: readonly ItineraryDto[],
    sortedBy: ItinerarySortKey,
  ): ItineraryDto[] {
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

    return priced.sort(comparatorFor(sortedBy));
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
   * **Non appelée pour un invité** (UF-801) : `plan` court-circuite en amont.
   * La table rattache chaque ligne à un compte, et il n'y en a pas ici — mais
   * la vraie raison est ailleurs : personne ne pourrait relire cet historique,
   * et conserver un déplacement que nul ne consultera est une collecte sans
   * finalité (C8).
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
 * Traduit les contraintes **de cette requête** en `appliedConstraints` publiable
 * (UF-602, étendu par UF-804).
 *
 * Le principe est le même pour les trois : on ne publie que ce qui a
 * effectivement retiré des options. Une contrainte inerte annoncée comme active
 * ferait chercher une explication là où il n'y en a pas, et userait la
 * confiance qu'on met dans les deux autres.
 */
function describeConstraints(
  reducedMobility: boolean,
  selectedModes: TransportMode[] | undefined,
  travellers: number,
): AppliedRouteConstraints {
  const constraints: AppliedRouteConstraints = { reducedMobility };

  if (selectedModes) {
    // Ce qui est publié, ce sont les modes **écartés**, pas les modes retenus.
    // Le client sait déjà ce qu'il a coché ; ce qu'il ne peut pas déduire, c'est
    // lesquelles de ses cases expliquent la liste qu'il a sous les yeux. La
    // marche n'y figure jamais : elle reste admise quoi qu'il arrive
    // (`usesOnlySelectedModes`), et l'annoncer exclue serait faux.
    const excludedModes = Object.values(TransportMode).filter(
      (mode) => mode !== TransportMode.WALK && !selectedModes.includes(mode),
    );
    if (excludedModes.length > 0) constraints.excludedModes = excludedModes;
  }

  // Un voyageur seul n'a rien retiré : l'annoncer ferait chercher une contrainte
  // là où il n'y en a pas.
  if (travellers > MIN_TRAVELLERS) constraints.travellers = travellers;

  return constraints;
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
