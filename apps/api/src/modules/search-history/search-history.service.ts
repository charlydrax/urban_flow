import { Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_SEARCH_HISTORY_LIMIT,
  MAX_SEARCH_HISTORY_LIMIT,
  type CarbonSegmentFootprint,
  type SearchHistoryEntry,
  type SearchHistoryPlace,
} from '@urbanflow/shared';

import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { CarbonService } from '../carbon/carbon.service';
import { RouteSegmentDto } from '../routes/dto/itinerary.dto';
import { CompleteTripDto } from './dto/complete-trip.dto';
import { SelectItineraryDto } from './dto/select-itinerary.dto';

/**
 * Ligne d'historique telle que la renvoient nos requêtes SQL.
 *
 * Les géométries n'en sortent jamais brutes : `ST_X`/`ST_Y` les reprojettent en
 * deux flottants au moment du SELECT. Le format PostGIS (WKB hexadécimal) reste
 * ainsi un détail de stockage, invisible du reste de l'application.
 */
interface SearchHistoryRow {
  id: string;
  fromLabel: string;
  fromLat: number;
  fromLng: number;
  toLabel: string;
  toLat: number;
  toLng: number;
  selectedSummary: string | null;
  carbonGrams: number | null;
  carEquivalentGrams: number | null;
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Ce qu'il faut pour ouvrir une ligne d'historique : deux lieux géocodés, et
 * rien d'autre.
 *
 * Volontairement plus étroit que `SearchHistoryEntry` : au moment où la
 * recherche part, aucun choix n'a été fait, aucune empreinte n'existe et le
 * trajet n'a pas eu lieu. Un paramètre qui accepterait ces champs laisserait
 * croire qu'ils peuvent être posés d'entrée — ce qui reviendrait à compter un
 * déplacement avant qu'il n'ait commencé (UF-807).
 */
type RecordedTrip = { from: SearchHistoryPlace; to: SearchHistoryPlace };

/**
 * Service Historique de recherche (UF-204).
 *
 * ## Les trois âges d'une ligne
 *
 * | Moment                        | Qui l'écrit                          | Ce qui est posé              |
 * | ----------------------------- | ------------------------------------ | ---------------------------- |
 * | la recherche part (étape 7)   | `RoutesService` (`POST /routes/plan`) | les deux extrémités          |
 * | une option est retenue        | `recordSelection` (UF-505)           | résumé + empreinte           |
 * | le guidage arrive (UF-806)    | `recordCompletion` (UF-807)          | `completed_at` + empreinte   |
 *
 * Ce service ne **crée** donc aucune ligne : il complète celles que le
 * planificateur a ouvertes. Les deux dernières étapes peuvent arriver dans
 * n'importe quel ordre, ou pas du tout — et c'est la troisième, elle seule, qui
 * fait entrer le trajet dans le suivi carbone. Retenir n'est pas parcourir.
 *
 * ## Pourquoi du SQL brut
 *
 * Les deux extrémités sont des `geometry(Point, 4326)` PostGIS, un type que
 * Prisma ne sait pas manipuler (`Unsupported` dans le schéma). Écriture comme
 * lecture passent donc par `$queryRaw`, exactement comme le fait `ST_DWithin`
 * pour les pistes cyclables (CLAUDE.md §4). Ce n'est pas un contournement : les
 * points seront interrogés spatialement, pas seulement relus.
 *
 * **Injection SQL (C4/OWASP A03)** : toutes les requêtes utilisent le *tagged
 * template* `$queryRaw` — chaque `${…}` devient un paramètre lié côté serveur
 * PostgreSQL, jamais une concaténation de chaîne. Aucune valeur venant du client
 * n'est interpolée dans le texte SQL.
 *
 * **Isolation (C4/OWASP A01)** : comme `UsersService`, aucune méthode n'accepte
 * de désigner un autre compte. Le `userId` est celui du JWT vérifié et sert de
 * clé à toutes les requêtes — c'est la recette 2 du ticket.
 *
 * Couvre : F2, C4, C5 (lecture bornée), C8 (données de déplacement cloisonnées),
 * C9 (géométries standard WGS84).
 */
@Injectable()
export class SearchHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carbon: CarbonService,
  ) {}

  /**
   * Ouvre la ligne d'historique d'une recherche qui vient d'être lancée
   * (étape 7 du flux, `INSERT search_history`).
   *
   * ## Appelée par le planificateur, et par lui seul (UF-807)
   *
   * `RoutesService.rememberSearch` est le **seul** appelant : c'est le calcul
   * d'itinéraires qui sait qu'une recherche a eu lieu, et lui qui en publie
   * l'identifiant dans `searchHistoryId`. La route HTTP jumelle
   * (`POST /api/search-history`) n'en avait plus depuis UF-403 ; elle est
   * retirée, et avec elle la possibilité d'écrire un nombre de grammes venu du
   * navigateur (C4).
   *
   * C'est pourquoi la signature ne prend plus que les deux extrémités : une
   * ligne naît **vide** de tout choix. Le résumé et l'empreinte arrivent plus
   * tard s'ils arrivent (`recordSelection`), et l'arrivée plus tard encore
   * (`recordCompletion`).
   *
   * ⚠️ `ST_MakePoint` attend (X, Y), donc **(longitude, latitude)** — l'inverse
   * de l'ordre d'écriture usuel. Une inversion ici enverrait silencieusement
   * tous les trajets lyonnais au large de la Somalie.
   *
   * L'identifiant est tiré côté applicatif (`randomUUID`) plutôt que par la
   * base : c'est la sémantique du `@default(uuid())` de Prisma, et cela évite de
   * dépendre d'une fonction serveur que la migration ne garantit pas.
   *
   * @param userId Identifiant issu du JWT vérifié — jamais du corps (C4)
   * @param trip Les deux extrémités géocodées de la recherche
   * @returns L'entrée créée, **relue depuis les colonnes géométriques**
   */
  async create(userId: string, trip: RecordedTrip): Promise<SearchHistoryEntry> {
    const [row] = await this.prisma.$queryRaw<SearchHistoryRow[]>`
      INSERT INTO search_history (id, user_id, from_label, from_geom, to_label, to_geom)
      VALUES (
        ${randomUUID()}::uuid,
        ${userId}::uuid,
        ${trip.from.label},
        ST_SetSRID(ST_MakePoint(${trip.from.lng}, ${trip.from.lat}), 4326),
        ${trip.to.label},
        ST_SetSRID(ST_MakePoint(${trip.to.lng}, ${trip.to.lat}), 4326)
      )
      RETURNING
        id,
        from_label       AS "fromLabel",
        ST_Y(from_geom)  AS "fromLat",
        ST_X(from_geom)  AS "fromLng",
        to_label         AS "toLabel",
        ST_Y(to_geom)    AS "toLat",
        ST_X(to_geom)    AS "toLng",
        selected_summary     AS "selectedSummary",
        carbon_grams         AS "carbonGrams",
        car_equivalent_grams AS "carEquivalentGrams",
        created_at           AS "createdAt",
        completed_at         AS "completedAt"
    `;

    return SearchHistoryService.toEntry(row);
  }

  /**
   * Les N dernières recherches du compte connecté, de la plus récente à la plus
   * ancienne.
   *
   * **Un trajet n'apparaît qu'une fois** (`DISTINCT ON`) : chercher trois fois
   * « Part-Dieu → Bellecour » remplirait sinon toute la liste de rappels d'une
   * seule et même ligne, ce qui la rendrait inutile. La base garde bien les
   * trois lignes — c'est l'affichage qui les replie, et le tableau de bord
   * carbone aura besoin du détail complet.
   *
   * Le dédoublonnage porte sur le couple de **libellés** et non sur les points :
   * c'est le texte que l'utilisateur relit et reclique ; deux résolutions à
   * quelques mètres près du même lieu doivent rester distinctes si elles ne
   * portent pas le même nom.
   *
   * @param userId Identifiant issu du JWT vérifié (C4)
   * @param limit Nombre d'entrées voulu — borné à `MAX_SEARCH_HISTORY_LIMIT` (C5)
   */
  async findRecent(userId: string, limit?: number): Promise<SearchHistoryEntry[]> {
    // Défense en profondeur : la borne est déjà posée par le DTO, mais le
    // service ne doit pas dépendre d'un appelant pour rester sûr.
    const take = Math.min(limit ?? DEFAULT_SEARCH_HISTORY_LIMIT, MAX_SEARCH_HISTORY_LIMIT);

    const rows = await this.prisma.$queryRaw<SearchHistoryRow[]>`
      SELECT * FROM (
        SELECT DISTINCT ON (from_label, to_label)
          id,
          from_label       AS "fromLabel",
          ST_Y(from_geom)  AS "fromLat",
          ST_X(from_geom)  AS "fromLng",
          to_label         AS "toLabel",
          ST_Y(to_geom)    AS "toLat",
          ST_X(to_geom)    AS "toLng",
          selected_summary     AS "selectedSummary",
          carbon_grams         AS "carbonGrams",
          car_equivalent_grams AS "carEquivalentGrams",
          created_at           AS "createdAt",
          completed_at         AS "completedAt"
        FROM search_history
        WHERE user_id = ${userId}::uuid
        -- DISTINCT ON impose de trier d'abord sur ses colonnes : la ligne
        -- retenue de chaque trajet est donc la plus récente.
        ORDER BY from_label, to_label, created_at DESC
      ) AS latest_per_trip
      ORDER BY "createdAt" DESC
      LIMIT ${take}
    `;

    return rows.map((row) => SearchHistoryService.toEntry(row));
  }

  /**
   * Inscrit sur une recherche l'itinéraire que l'usager a **retenu** (UF-505).
   *
   * ## Retenu n'est pas parcouru (UF-807)
   *
   * Cette écriture dit « voilà l'option que je regarde », rien de plus. Elle ne
   * pose **pas** `completed_at`, et le trajet n'entre donc pas dans le suivi
   * carbone : c'est l'arrivée du guidage qui l'y fait entrer
   * (`recordCompletion`). Le résumé et l'empreinte restent utiles — ils rendent
   * la ligne d'historique lisible et évitent de tout recalculer à l'arrivée —
   * mais ils ne suffisent plus à faire compter un trajet.
   *
   * ## Pourquoi une écriture séparée de la recherche
   *
   * La ligne d'historique naît à l'étape 7 du flux, au moment où la recherche
   * part — donc avant qu'aucune option n'existe. Inscrire d'office la première
   * proposition ferait passer un classement du serveur pour une décision de
   * l'usager. Le choix arrive plus tard, ou n'arrive jamais ; c'est un second
   * appel, et c'est la raison d'être de cet endpoint.
   *
   * ## Un trajet réalisé ne se réécrit pas
   *
   * L'écriture exige `completed_at IS NULL`. Revenir sur la liste après une
   * arrivée et cliquer une autre option ne doit pas revaloriser le trajet
   * parcouru avec un itinéraire qui ne l'a pas été : ce qui a eu lieu est un
   * fait, pas une préférence. La ligne est alors rendue **inchangée**, sans
   * erreur — l'usager n'a rien fait de fautif, il regarde les autres options.
   *
   * @param userId Identifiant issu du JWT vérifié (C4)
   * @param id Ligne d'historique à compléter, telle que rendue par `POST /routes/plan`
   * @param dto Option retenue : résumé + segments à valoriser
   * @returns L'entrée mise à jour — ou telle quelle si le trajet est déjà réalisé
   * @throws {NotFoundException} si la ligne n'existe pas ou n'appartient pas au compte
   */
  recordSelection(
    userId: string,
    id: string,
    dto: SelectItineraryDto,
  ): Promise<SearchHistoryEntry> {
    return this.writeItinerary(userId, id, dto, false);
  }

  /**
   * Marque un trajet **réalisé** : le guidage (UF-806) a atteint la destination
   * (UF-807).
   *
   * ## Pourquoi cet appel valorise aussi le trajet
   *
   * Il pose l'horodatage d'arrivée **et** l'empreinte, en une transaction. La
   * première option de la liste étant présélectionnée sans clic (UF-404), un
   * usager peut parfaitement démarrer le guidage sans avoir jamais émis de
   * sélection : exiger qu'un `PATCH .../selection` ait précédé ferait
   * disparaître du bilan des trajets bel et bien parcourus. Et scinder en deux
   * appels ouvrirait une fenêtre où un trajet serait réalisé sans empreinte,
   * donc compté pour zéro gramme.
   *
   * ## L'heure d'arrivée est celle du serveur, et la première fait foi
   *
   * `NOW()` plutôt qu'un horodatage reçu : une date venue du navigateur
   * permettrait de ranger un trajet dans la période de son choix, et l'horloge
   * d'un mobile n'est de toute façon pas une source de temps fiable (C4).
   *
   * `COALESCE` : rejouer l'arrivée — le réseau réessaie, l'usager relance le
   * guidage sur le même trajet — ne déplace pas la date du premier passage.
   * L'appel est donc **rejouable**, ce qu'il faut à un client susceptible de
   * perdre le réseau au moment précis où il arrive.
   *
   * @param userId Identifiant issu du JWT vérifié (C4)
   * @param id Ligne d'historique du trajet parcouru
   * @param dto Trajet réalisé : résumé + segments à valoriser
   * @returns L'entrée mise à jour, `completedAt` renseigné
   * @throws {NotFoundException} si la ligne n'existe pas ou n'appartient pas au compte
   */
  recordCompletion(userId: string, id: string, dto: CompleteTripDto): Promise<SearchHistoryEntry> {
    return this.writeItinerary(userId, id, dto, true);
  }

  /**
   * Écriture commune à la sélection et à l'arrivée (UF-505 / UF-807).
   *
   * Les deux déposent exactement la même chose — un résumé, les deux totaux du
   * Service Carbone et la ventilation par mode — et ne diffèrent que par
   * `completed_at`. Les tenir séparées ferait exister deux valorisations d'un
   * même trajet, qu'il faudrait ensuite garder d'accord.
   *
   * ## L'empreinte est calculée ici, pas reçue
   *
   * Le corps ne porte que des modes et des distances. `computeFootprint` en
   * tire l'empreinte **et** la référence voiture, au même barème que la liste
   * de résultats — le Service Carbone reste l'autorité unique, et un client ne
   * peut pas s'inscrire un bilan flatteur en postant zéro gramme (C4).
   *
   * Les deux valeurs sont figées en base à cet instant : le barème est
   * provisoire et s'affinera, mais un bilan personnel dont les mois passés se
   * réécriraient à chaque mise à jour ne serait pas un historique.
   *
   * ## Ce que l'écriture dépose, depuis UF-805
   *
   * En plus des deux totaux, la **ventilation par mode** (`trip_mode_footprints`).
   * Sans elle, la répartition par mode et la colonne « Distance » du tableau par
   * trajet restaient incalculables : `search_history` ne conserve que deux
   * points, et la distance à vol d'oiseau n'est pas celle du trajet réel. Les
   * écritures tiennent dans la même transaction — un trajet qui pèserait dans
   * les totaux sans figurer dans la répartition serait un écart visible à
   * l'écran.
   *
   * ## Isolation (C4 / OWASP A01)
   *
   * L'UUID vient du chemin, donc du client. Le `WHERE` porte sur **le couple**
   * `(id, user_id)` : viser la ligne d'un autre compte ne met rien à jour, et
   * l'absence de `RETURNING` devient un 404. L'attaquant ne peut pas non plus
   * distinguer « cette ligne n'existe pas » de « elle ne vous appartient pas »,
   * ce qui éviterait sinon d'énumérer les identifiants d'autrui.
   *
   * @param userId Identifiant issu du JWT vérifié (C4)
   * @param id Ligne d'historique visée
   * @param dto Itinéraire à valoriser
   * @param completed `true` à l'arrivée du guidage : pose `completed_at`
   */
  private async writeItinerary(
    userId: string,
    id: string,
    dto: SelectItineraryDto,
    completed: boolean,
  ): Promise<SearchHistoryEntry> {
    // Le barème n'a besoin que du mode et de la distance ; les autres champs de
    // `RouteSegmentDto` (libellés, horaires, tracé) ne pèsent rien dans le
    // calcul et n'ont donc pas à traverser le réseau (C5).
    const footprint = this.carbon.computeFootprint(
      dto.segments.map((segment) => ({ ...segment }) as RouteSegmentDto),
    );

    // La valorisation et sa ventilation par mode forment **un seul fait** : un
    // trajet valorisé dont on ne saurait pas de quels modes il est fait
    // n'apparaîtrait ni dans la répartition ni dans le tableau par trajet, tout
    // en pesant dans les totaux — un écart visible à l'écran (UF-805). D'où la
    // transaction : les écritures réussissent ensemble ou pas du tout.
    const row = await this.prisma.$transaction(async (tx) => {
      const [updated] = await tx.$queryRaw<SearchHistoryRow[]>`
        UPDATE search_history
        SET
          selected_summary     = ${dto.selectedSummary},
          carbon_grams         = ${footprint.totalGrams},
          car_equivalent_grams = ${footprint.carEquivalentGrams},
          -- Un paramètre lié plutôt que deux requêtes : entre une sélection et
          -- une arrivée, cette colonne est la seule différence. COALESCE — la
          -- **première** arrivée fait foi, rejouer l'appel ne la déplace pas.
          completed_at         = CASE
                                   WHEN ${completed}::boolean THEN COALESCE(completed_at, NOW())
                                   ELSE completed_at
                                 END
        WHERE id = ${id}::uuid
          AND user_id = ${userId}::uuid
          -- Un trajet déjà parcouru ne se revalorise pas depuis la liste de
          -- résultats (UF-807) : ce qui a eu lieu est un fait. L'arrivée, elle,
          -- doit rester rejouable — d'où la levée du verrou pour elle seule.
          AND (${completed}::boolean OR completed_at IS NULL)
        RETURNING
          id,
          from_label           AS "fromLabel",
          ST_Y(from_geom)      AS "fromLat",
          ST_X(from_geom)      AS "fromLng",
          to_label             AS "toLabel",
          ST_Y(to_geom)        AS "toLat",
          ST_X(to_geom)        AS "toLng",
          selected_summary     AS "selectedSummary",
          carbon_grams         AS "carbonGrams",
          car_equivalent_grams AS "carEquivalentGrams",
          created_at           AS "createdAt",
          completed_at         AS "completedAt"
      `;

      // Sortie anticipée : c'est ce `UPDATE` filtré sur le couple `(id, user_id)`
      // qui fait l'autorisation. Les écritures suivantes ne portent que
      // `searchHistoryId`, sans filtre de propriétaire ; ne les atteindre qu'ici
      // est ce qui empêche d'effacer la ventilation d'un trajet d'autrui en
      // devinant son UUID (C4 / OWASP A01).
      if (!updated) return null;

      // Remplacement et non ajout : changer d'avis sur une option déjà retenue
      // doit refaire la ventilation, pas la cumuler à la précédente. La
      // contrainte d'unicité `(search_history_id, mode)` refuserait de toute
      // façon le doublon — autant que le code dise la même chose qu'elle.
      await tx.tripModeFootprint.deleteMany({ where: { searchHistoryId: id } });
      await tx.tripModeFootprint.createMany({
        data: SearchHistoryService.toModeFootprints(id, footprint.segments),
      });

      return updated;
    });

    if (row) return SearchHistoryService.toEntry(row);

    // Rien mis à jour : soit la ligne n'existe pas (ou appartient à autrui),
    // soit elle est déjà réalisée et refuse d'être revalorisée. Une relecture
    // sépare les deux — le client, lui, ne reçoit jamais la différence sous
    // forme de message (C11).
    const existing = await this.findOwned(userId, id);
    if (existing) return existing;

    // C11 : le message ne dit ni quel identifiant a été visé ni s'il existe
    // ailleurs — un journal d'erreur ne doit pas devenir un oracle.
    throw new NotFoundException('Recherche introuvable dans votre historique.');
  }

  /**
   * Relit une ligne du compte connecté, sans rien y écrire.
   *
   * Appelée sur le seul chemin où l'`UPDATE` n'a rien touché, pour séparer
   * « ligne inconnue » de « trajet déjà réalisé » — deux situations qui ne
   * méritent pas la même réponse (404 contre 200 inchangé), et qu'un `UPDATE`
   * sans effet confond.
   *
   * @param userId Identifiant issu du JWT vérifié (C4)
   * @param id Ligne visée
   * @returns L'entrée, ou `null` si elle n'existe pas ou n'appartient pas au compte
   */
  private async findOwned(userId: string, id: string): Promise<SearchHistoryEntry | null> {
    const [row] = await this.prisma.$queryRaw<SearchHistoryRow[]>`
      SELECT
        id,
        from_label           AS "fromLabel",
        ST_Y(from_geom)      AS "fromLat",
        ST_X(from_geom)      AS "fromLng",
        to_label             AS "toLabel",
        ST_Y(to_geom)        AS "toLat",
        ST_X(to_geom)        AS "toLng",
        selected_summary     AS "selectedSummary",
        carbon_grams         AS "carbonGrams",
        car_equivalent_grams AS "carEquivalentGrams",
        created_at           AS "createdAt",
        completed_at         AS "completedAt"
      FROM search_history
      WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
    `;

    return row ? SearchHistoryService.toEntry(row) : null;
  }

  /**
   * Agrège les lignes segment par segment du Service Carbone en **une ligne par
   * mode**, prête pour `trip_mode_footprints` (UF-805).
   *
   * Un itinéraire « marche → bus → marche » compte trois segments mais deux
   * modes : la page « Mon impact » trace une barre par mode, jamais par segment,
   * et l'écran de résultats reste le seul endroit où le détail segment par
   * segment a un sens. Agréger ici plutôt qu'à la lecture supprime un `GROUP BY`
   * de chaque affichage du tableau de bord (C5/C10) et respecte la contrainte
   * d'unicité `(search_history_id, mode)`.
   *
   * @param searchHistoryId Ligne d'historique à laquelle rattacher la ventilation
   * @param segments Détail par segment produit par `computeFootprint`
   * @returns Une entrée par mode réellement emprunté, prête pour `createMany`
   */
  private static toModeFootprints(
    searchHistoryId: string,
    segments: CarbonSegmentFootprint[],
  ): { searchHistoryId: string; mode: string; distanceMeters: number; grams: number }[] {
    const byMode = new Map<string, { distanceMeters: number; grams: number }>();

    for (const segment of segments) {
      const totals = byMode.get(segment.mode) ?? { distanceMeters: 0, grams: 0 };
      // `Math.max(0, …)` : même garde que le barème, une distance négative
      // arrivée d'un connecteur ne doit pas retrancher des kilomètres au cumul.
      totals.distanceMeters += Math.max(0, segment.distanceMeters || 0);
      totals.grams += segment.grams;
      byMode.set(segment.mode, totals);
    }

    return [...byMode.entries()].map(([mode, totals]) => ({
      searchHistoryId,
      mode,
      distanceMeters: Math.round(totals.distanceMeters),
      grams: totals.grams,
    }));
  }

  /** Projette une ligne SQL en contrat d'API (dates sérialisées en ISO 8601 — C9). */
  private static toEntry(row: SearchHistoryRow): SearchHistoryEntry {
    return {
      id: row.id,
      from: { label: row.fromLabel, lat: row.fromLat, lng: row.fromLng },
      to: { label: row.toLabel, lat: row.toLat, lng: row.toLng },
      selectedSummary: row.selectedSummary,
      carbonGrams: row.carbonGrams,
      carEquivalentGrams: row.carEquivalentGrams,
      createdAt: row.createdAt.toISOString(),
      // `?? null` plutôt qu'une date par défaut : « pas encore parcouru » est un
      // état, pas une valeur manquante à combler (UF-807).
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}
