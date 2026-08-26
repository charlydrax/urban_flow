import { Injectable } from '@nestjs/common';
import {
  DEFAULT_SEARCH_HISTORY_LIMIT,
  MAX_SEARCH_HISTORY_LIMIT,
  type SearchHistoryEntry,
} from '@urbanflow/shared';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateSearchHistoryDto } from './dto/create-search-history.dto';

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
  createdAt: Date;
}

/**
 * Service Historique de recherche (UF-204) — étape 18 de la séquence de
 * référence (`INSERT search_history`).
 *
 * ## Pourquoi du SQL brut
 *
 * Les deux extrémités sont des `geometry(Point, 4326)` PostGIS, un type que
 * Prisma ne sait pas manipuler (`Unsupported` dans le schéma). Écriture comme
 * lecture passent donc par `$queryRaw`, exactement comme le fera `ST_DWithin`
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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enregistre une recherche d'itinéraire pour le compte connecté.
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
   * @param dto Trajet validé (coordonnées obligatoires)
   * @returns L'entrée créée, **relue depuis les colonnes géométriques**
   */
  async create(userId: string, dto: CreateSearchHistoryDto): Promise<SearchHistoryEntry> {
    const [row] = await this.prisma.$queryRaw<SearchHistoryRow[]>`
      INSERT INTO search_history (
        id, user_id, from_label, from_geom, to_label, to_geom, selected_summary, carbon_grams
      )
      VALUES (
        ${randomUUID()}::uuid,
        ${userId}::uuid,
        ${dto.from.label},
        ST_SetSRID(ST_MakePoint(${dto.from.lng}, ${dto.from.lat}), 4326),
        ${dto.to.label},
        ST_SetSRID(ST_MakePoint(${dto.to.lng}, ${dto.to.lat}), 4326),
        ${dto.selectedSummary ?? null},
        ${dto.carbonGrams ?? null}
      )
      RETURNING
        id,
        from_label       AS "fromLabel",
        ST_Y(from_geom)  AS "fromLat",
        ST_X(from_geom)  AS "fromLng",
        to_label         AS "toLabel",
        ST_Y(to_geom)    AS "toLat",
        ST_X(to_geom)    AS "toLng",
        selected_summary AS "selectedSummary",
        carbon_grams     AS "carbonGrams",
        created_at       AS "createdAt"
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
          selected_summary AS "selectedSummary",
          carbon_grams     AS "carbonGrams",
          created_at       AS "createdAt"
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

  /** Projette une ligne SQL en contrat d'API (dates sérialisées en ISO 8601 — C9). */
  private static toEntry(row: SearchHistoryRow): SearchHistoryEntry {
    return {
      id: row.id,
      from: { label: row.fromLabel, lat: row.fromLat, lng: row.fromLng },
      to: { label: row.toLabel, lat: row.toLat, lng: row.toLng },
      selectedSummary: row.selectedSummary,
      carbonGrams: row.carbonGrams,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
