import { Injectable } from '@nestjs/common';
import {
  CARBON_SUMMARY_BUCKETS,
  CARBON_TRIPS_MAX,
  type CarbonFootprint,
  type CarbonGoal,
  type CarbonModeTotals,
  type CarbonPeriodTotals,
  type CarbonSegmentFootprint,
  type CarbonSummary,
  type CarbonSummaryDays,
  type CarbonTripsPage,
  type TransportMode,
} from '@urbanflow/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { RouteSegmentDto } from '../routes/dto/itinerary.dto';
import { GRAMS_PER_PASSENGER_KM, carReferenceGrams, segmentCarbonGrams } from './emission-factors';

/**
 * Une tranche du découpage temporel, telle que la rend l'agrégat SQL.
 * `bucket` est l'indice de la tranche depuis le début de la fenêtre analysée.
 */
interface CarbonBucketRow {
  bucket: number;
  emittedGrams: number;
  carEquivalentGrams: number;
  tripsCount: number;
  unpricedCount: number;
}

/**
 * Cumul d'un mode sur la période, tel que le rend l'agrégat SQL (UF-805).
 * `tripsCount` compte les **trajets** distincts, pas les lignes : un trajet
 * avec deux segments de bus ne l'a emprunté qu'une fois.
 */
interface CarbonModeRow {
  mode: TransportMode;
  distanceMeters: number;
  grams: number;
  tripsCount: number;
}

/** Un trajet valorisé, avant assemblage avec sa ventilation par mode (UF-805). */
interface CarbonTripRow {
  id: string;
  createdAt: Date;
  fromLabel: string;
  toLabel: string;
  selectedSummary: string | null;
  emittedGrams: number;
  carEquivalentGrams: number;
}

/**
 * Service Carbone (fonctionnalité au choix retenue) — étapes 16-17 du flux.
 *
 * Autorité unique sur l'empreinte publiée : `computeFootprint` **recalcule**
 * chaque segment à partir de son mode et de sa distance, au lieu de faire
 * confiance à la valeur qu'il porte. Un segment fabriqué par la fusion (UF-401)
 * et un segment venu d'ailleurs sont ainsi valorisés au même barème, et une
 * évolution du barème (`emission-factors.ts`) se propage sans que personne
 * n'ait à ré-émettre ses segments.
 *
 * ⚠️ Le barème reste **provisoire** — ordres de grandeur de la Base Empreinte
 * ADEME, à affiner par un ticket dédié (taux d'occupation réels, mix
 * électrique, VAE). Il classe correctement les modes entre eux, ce qui est ce
 * dont le tri a besoin.
 *
 * Couvre : proposition de valeur écologique du produit ; alimente le tri par
 * CO₂ croissant (étape 9 du flux) et le tableau de bord personnel.
 */
@Injectable()
export class CarbonService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcule l'empreinte carbone d'un itinéraire, **segment par segment**
   * (UF-501, étapes 16-17 du flux).
   *
   * ## Pourquoi un objet et non un nombre
   *
   * Le service rendait un total seul. Un total ne dit pas *où* part le CO₂ :
   * « 240 g » ne prévient pas que 235 viennent des huit minutes de bus et 5 du
   * reste. Publier le détail rend le chiffre vérifiable — chaque ligne porte le
   * facteur qui l'a produite, donc se refait de tête — et actionnable : c'est le
   * segment coûteux que l'usager peut décider de remplacer.
   *
   * Le total reste la **somme exacte des lignes**, jamais un calcul parallèle :
   * arrondir segment par segment puis sommer, ou sommer puis arrondir, ne donne
   * pas le même nombre, et un total qui ne serait pas celui des lignes
   * affichées serait une erreur visible à l'écran.
   *
   * ## La référence voiture
   *
   * L'empreinte est accompagnée de ce que la même distance aurait coûté seul en
   * voiture. Un gramme ne parle à personne dans l'absolu : c'est la comparaison
   * qui porte la proposition de valeur écologique du produit.
   *
   * Couvre : proposition de valeur écologique ; alimente le tri par CO₂
   * croissant (étape 9) et l'écran de résultats.
   *
   * @param segments Segments multimodaux de l'itinéraire, dans l'ordre du trajet
   * @returns Total en grammes de CO₂e, détail par segment (même ordre) et
   * comparaison voiture
   */
  computeFootprint(segments: RouteSegmentDto[]): CarbonFootprint {
    const detail: CarbonSegmentFootprint[] = segments.map((segment) => ({
      mode: segment.mode,
      distanceMeters: segment.distanceMeters,
      factorGramsPerKm: GRAMS_PER_PASSENGER_KM[segment.mode],
      grams: segmentCarbonGrams(segment.mode, segment.distanceMeters),
    }));

    const totalGrams = detail.reduce((total, line) => total + line.grams, 0);

    // La référence porte sur la distance **réellement parcourue** par cet
    // itinéraire, pas sur la distance à vol d'oiseau : c'est le trajet que
    // l'usager avait à faire, et le seul dont on connaisse la longueur.
    const carEquivalentGrams = carReferenceGrams(
      segments.reduce((total, segment) => total + Math.max(0, segment.distanceMeters || 0), 0),
    );

    return {
      totalGrams,
      segments: detail,
      carEquivalentGrams,
      // Jamais de « gain » négatif : un itinéraire pire que la voiture (aucun
      // ne l'est au barème actuel) n'a rien fait économiser, il n'a pas fait
      // économiser « moins que rien ».
      avoidedGrams: Math.max(0, carEquivalentGrams - totalGrams),
    };
  }

  /**
   * Suivi carbone personnel du compte connecté (UF-505) — la matière de la page
   * « Mon impact ».
   *
   * ## Ce qui est compté
   *
   * Uniquement les recherches sur lesquelles un itinéraire a été **retenu**
   * (`carbon_grams IS NOT NULL`, posé par `PATCH /search-history/:id/selection`).
   * Une recherche lancée puis abandonnée reste dans l'historique — elle sert les
   * rappels du planificateur — mais ne pèse rien ici : additionner des
   * suggestions du serveur ferait un bilan de trajets que personne n'a faits.
   *
   * Ces recherches non valorisées sont tout de même **dénombrées** et publiées
   * (`unpricedTripsCount`). Sans elles, quelqu'un qui cherche beaucoup et
   * choisit peu verrait un total anormalement bas sans pouvoir comprendre
   * pourquoi, et conclurait à une panne.
   *
   * ## Pourquoi une seule requête, et pourquoi ici
   *
   * Les deux périodes (courante et précédente) et les quatre tranches du
   * graphique sortent d'un **unique** `GROUP BY` : découper la fenêtre en
   * tranches d'égale durée puis grouper sur l'indice de tranche donne tout d'un
   * coup, là où une requête par tranche en ferait huit pour un seul écran
   * (C5/C10). Les bornes sont calculées ici, en TypeScript, pour que le SQL
   * n'ait aucune arithmétique de calendrier à faire.
   *
   * Le module carbone interroge `search_history` **directement**, sans passer
   * par `SearchHistoryService`. Ce n'est pas un contournement : ce service
   * existe pour encapsuler les géométries PostGIS (`ST_MakePoint`, `ST_X`), or
   * un agrégat de sommes n'en touche aucune — il ne matérialise jamais une
   * entrée d'historique. L'y loger imposerait par ailleurs un cycle entre les
   * deux modules, puisque `search-history` dépend déjà de ce service-ci pour
   * valoriser une sélection.
   *
   * ## Fenêtre glissante, pas mois calendaire
   *
   * « Les 30 derniers jours » et non « ce mois-ci » : un bilan mensuel est
   * quasiment vide le 1er du mois, et l'évolution qu'il afficherait le 2 ne
   * voudrait rien dire. Une fenêtre glissante et sa jumelle immédiatement
   * antérieure comparent toujours deux durées identiques.
   *
   * Couvre : C4/C8 (les données ne sortent que vers leur propriétaire),
   * C5/C10 (une requête, des sommes faites par la base).
   *
   * @param userId Identité issue du JWT — l'utilisateur ne voit que SES données (C8/C11)
   * @param days Durée de la période affichée, en jours
   * @param now Instant de référence, injectable pour les tests
   * @returns Totaux de la période, de la précédente, série du graphique et trajets non valorisés
   */
  async getSummary(
    userId: string,
    days: CarbonSummaryDays,
    now: Date = new Date(),
  ): Promise<CarbonSummary> {
    const bucketMs = (days * 24 * 60 * 60 * 1000) / CARBON_SUMMARY_BUCKETS;
    // La fenêtre analysée couvre les DEUX périodes : la courante et celle qui la
    // précède, découpées en tranches de même durée. Les tranches 0..3 forment la
    // période précédente, 4..7 la période courante.
    const totalBuckets = CARBON_SUMMARY_BUCKETS * 2;
    const boundaryAt = (index: number): Date =>
      new Date(now.getTime() - (totalBuckets - index) * bucketMs);

    const spanFrom = boundaryAt(0);

    // Borne basse de la période AFFICHÉE — la tranche 4 ouvre la période
    // courante, soit exactement `now - days`. Les agrégats par mode et le
    // tableau par trajet s'arrêtent là où le bandeau vert commence, sans quoi
    // deux blocs du même écran couvriraient deux fenêtres différentes.
    const currentFrom = boundaryAt(CARBON_SUMMARY_BUCKETS);

    // Trois lectures indépendantes : la base les traite en parallèle plutôt
    // qu'en file (C10). Aucune ne dépend du résultat des autres — la
    // ventilation par mode et l'objectif ne servent qu'à composer la réponse.
    const [rows, modeRows, profile] = await Promise.all([
      this.prisma.$queryRaw<CarbonBucketRow[]>`
        SELECT
          -- Indice de tranche : (âge de la ligne dans la fenêtre) / (durée d'une
          -- tranche). Les bornes arrivent en paramètres liés, donc aucune date
          -- n'est concaténée dans le texte SQL (C4 / OWASP A03).
          FLOOR(
            EXTRACT(EPOCH FROM (created_at - ${spanFrom}::timestamptz)) * 1000 / ${bucketMs}
          )::int AS "bucket",
          -- COALESCE : une tranche sans trajet valorisé vaut 0, pas NULL — le
          -- graphique doit pouvoir tracer une barre nulle, pas un trou.
          -- Cast ::int : PostgreSQL somme les entiers en bigint, que le pilote
          -- rendrait en BigInt, non sérialisable en JSON.
          COALESCE(SUM(carbon_grams), 0)::int         AS "emittedGrams",
          COALESCE(SUM(car_equivalent_grams), 0)::int AS "carEquivalentGrams",
          COUNT(*) FILTER (WHERE carbon_grams IS NOT NULL)::int AS "tripsCount",
          COUNT(*) FILTER (WHERE carbon_grams IS NULL)::int     AS "unpricedCount"
        FROM search_history
        WHERE user_id = ${userId}::uuid
          AND created_at >= ${spanFrom}
          AND created_at < ${now}
        GROUP BY 1
        ORDER BY 1
      `,
      // Répartition par mode de la période affichée (UF-805).
      //
      // La jointure part de `trip_mode_footprints` et remonte vers
      // `search_history` : c'est là que vivent le propriétaire et la date, et
      // c'est le seul filtre qui garantisse qu'un compte ne lit que ses
      // ventilations (C4 / OWASP A01). `carbon_grams IS NOT NULL` est implicite
      // — une ligne de ventilation n'existe que pour un trajet retenu.
      //
      // `COUNT(DISTINCT …)` et non `COUNT(*)` : la table porte déjà une ligne
      // par mode et par trajet, mais compter les lignes dirait « 2 trajets en
      // bus » là où l'usager en a fait un seul avec deux tronçons.
      this.prisma.$queryRaw<CarbonModeRow[]>`
        SELECT
          f.mode                                    AS "mode",
          COALESCE(SUM(f.distance_meters), 0)::int  AS "distanceMeters",
          COALESCE(SUM(f.grams), 0)::int            AS "grams",
          COUNT(DISTINCT f.search_history_id)::int  AS "tripsCount"
        FROM trip_mode_footprints f
        JOIN search_history h ON h.id = f.search_history_id
        WHERE h.user_id = ${userId}::uuid
          AND h.created_at >= ${currentFrom}
          AND h.created_at <  ${now}
        GROUP BY f.mode
        -- La barre la plus longue en haut : devant ce bloc, la question de
        -- l'usager est « qu'est-ce qui pèse le plus ? ».
        ORDER BY 3 DESC
      `,
      // Objectif mensuel — lu via le client typé : `mobility_profiles` ne porte
      // aucune géométrie, le SQL brut du reste du module n'a pas lieu d'être ici.
      this.prisma.mobilityProfile.findUnique({
        where: { userId },
        select: { monthlyCarbonGoalGrams: true },
      }),
    ]);

    // Les tranches vides ne sortent pas du GROUP BY : on part d'une série
    // complète et on y range ce que la base a rendu. Une période sans trajet
    // doit afficher quatre barres à zéro, pas un graphique absent.
    const series: CarbonBucketRow[] = Array.from({ length: totalBuckets }, (_, bucket) => ({
      bucket,
      emittedGrams: 0,
      carEquivalentGrams: 0,
      tripsCount: 0,
      unpricedCount: 0,
    }));

    for (const row of rows) {
      // Garde-fou contre l'arrondi flottant sur la borne haute : une ligne
      // insérée à l'instant même de l'appel pourrait ressortir en tranche 8.
      const index = Math.min(Math.max(row.bucket, 0), totalBuckets - 1);
      const slot = series[index];
      slot.emittedGrams += row.emittedGrams;
      slot.carEquivalentGrams += row.carEquivalentGrams;
      slot.tripsCount += row.tripsCount;
      slot.unpricedCount += row.unpricedCount;
    }

    /** Agrège une plage de tranches (bornes incluses) en totaux de période. */
    const totalsOf = (firstBucket: number, lastBucket: number): CarbonPeriodTotals => {
      const slice = series.slice(firstBucket, lastBucket + 1);
      const emittedGrams = slice.reduce((sum, row) => sum + row.emittedGrams, 0);
      const carEquivalentGrams = slice.reduce((sum, row) => sum + row.carEquivalentGrams, 0);

      return {
        from: boundaryAt(firstBucket).toISOString(),
        to: boundaryAt(lastBucket + 1).toISOString(),
        emittedGrams,
        carEquivalentGrams,
        // Jamais négatif, même règle que `computeFootprint` : un bilan pire que
        // la voiture n'a pas fait économiser « moins que rien ».
        avoidedGrams: Math.max(0, carEquivalentGrams - emittedGrams),
        tripsCount: slice.reduce((sum, row) => sum + row.tripsCount, 0),
      };
    };

    const previous = totalsOf(0, CARBON_SUMMARY_BUCKETS - 1);
    const current = totalsOf(CARBON_SUMMARY_BUCKETS, totalBuckets - 1);

    return {
      current,
      previous,
      emittedChangePercent: CarbonService.changePercent(
        previous.emittedGrams,
        current.emittedGrams,
      ),
      buckets: Array.from({ length: CARBON_SUMMARY_BUCKETS }, (_, offset) => {
        const bucket = CARBON_SUMMARY_BUCKETS + offset;
        return totalsOf(bucket, bucket);
      }),
      unpricedTripsCount: series
        .slice(CARBON_SUMMARY_BUCKETS)
        .reduce((sum, row) => sum + row.unpricedCount, 0),
      // Rendu tel quel : la base a déjà trié par grammes décroissants, et
      // retrier ici ferait faire deux fois le même travail (C5).
      modeBreakdown: modeRows,
      goal: CarbonService.buildGoal(
        profile?.monthlyCarbonGoalGrams ?? null,
        days,
        current.emittedGrams,
      ),
    };
  }

  /**
   * Trajets valorisés de la période, pour le tableau « Détail par trajet » de la
   * planche et pour l'export (UF-805).
   *
   * ## Deux lectures plutôt qu'une jointure
   *
   * Les trajets et leurs ventilations sont lus séparément, puis assemblés en
   * mémoire. Une jointure unique rendrait autant de fois les libellés, la date
   * et les deux totaux d'un trajet qu'il compte de modes — soit deux à quatre
   * fois le même contenu sur le réseau, pour épargner un aller-retour à une base
   * qui est en local (C5). L'assemblage se fait par `Map`, en un seul parcours.
   *
   * ## Plafond assumé, et annoncé
   *
   * `CARBON_TRIPS_MAX` borne la réponse : c'est un écran, pas un entrepôt. Le
   * dépassement est **publié** (`truncated`) parce que l'export se construit à
   * partir de cette liste, et qu'un relevé incomplet qui ne le dirait pas serait
   * un faux relevé.
   *
   * Couvre : C4/C8 (le filtre `user_id` est la seule porte d'entrée, aucun
   * identifiant de compte n'est accepté), C5/C10 (deux requêtes bornées).
   *
   * @param userId Identité issue du JWT — l'utilisateur ne voit que SES trajets (C8/C11)
   * @param days Durée de la période affichée, en jours
   * @param now Instant de référence, injectable pour les tests
   * @returns Les trajets de la période, du plus récent au plus ancien
   */
  async listTrips(
    userId: string,
    days: CarbonSummaryDays,
    now: Date = new Date(),
  ): Promise<CarbonTripsPage> {
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // `LIMIT max + 1` : une ligne de trop suffit à savoir qu'il y en avait
    // davantage, là où un `COUNT(*)` séparé ferait une seconde passe sur la
    // même fenêtre pour la même information (C5).
    const rows = await this.prisma.$queryRaw<CarbonTripRow[]>`
      SELECT
        id,
        created_at                     AS "createdAt",
        from_label                     AS "fromLabel",
        to_label                       AS "toLabel",
        selected_summary               AS "selectedSummary",
        carbon_grams                   AS "emittedGrams",
        COALESCE(car_equivalent_grams, 0)::int AS "carEquivalentGrams"
      FROM search_history
      WHERE user_id = ${userId}::uuid
        AND created_at >= ${from}
        AND created_at < ${now}
        -- Un trajet sans empreinte est une recherche abandonnée : elle est
        -- dénombrée à part par getSummary (unpricedTripsCount), pas listée ici.
        AND carbon_grams IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${CARBON_TRIPS_MAX + 1}
    `;

    const truncated = rows.length > CARBON_TRIPS_MAX;
    const page = truncated ? rows.slice(0, CARBON_TRIPS_MAX) : rows;

    // Client typé et non SQL brut : `trip_mode_footprints` ne porte aucune
    // géométrie, et le `IN` généré par Prisma est paramétré comme le reste (C4).
    const footprints = await this.prisma.tripModeFootprint.findMany({
      where: { searchHistoryId: { in: page.map((row) => row.id) } },
      // Décroissant par empreinte : la colonne « Mode » du tableau n'a la place
      // que d'une poignée de pictogrammes, autant montrer d'abord celui qui pèse.
      orderBy: { grams: 'desc' },
    });

    const byTrip = new Map<string, CarbonModeTotals[]>();
    for (const line of footprints) {
      const modes = byTrip.get(line.searchHistoryId) ?? [];
      modes.push({
        mode: line.mode as TransportMode,
        distanceMeters: line.distanceMeters,
        grams: line.grams,
        // Un mode compté au niveau d'UN trajet y figure une fois, par
        // construction de la contrainte d'unicité. Le champ n'a de variété
        // qu'agrégé sur une période (`CarbonSummary.modeBreakdown`), et il est
        // conservé ici pour que les deux usages partagent un seul type (C9).
        tripsCount: 1,
      });
      byTrip.set(line.searchHistoryId, modes);
    }

    return {
      trips: page.map((row) => {
        const modes = byTrip.get(row.id) ?? [];
        return {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          fromLabel: row.fromLabel,
          toLabel: row.toLabel,
          selectedSummary: row.selectedSummary,
          modes,
          // Somme des distances par mode plutôt qu'une colonne de plus : les
          // deux diraient la même chose, et deux vérités valent une divergence.
          // Vaut 0 pour un trajet retenu avant UF-805, qui n'a pas de
          // ventilation — l'écran l'affiche alors comme inconnue, pas comme nulle.
          distanceMeters: modes.reduce((total, mode) => total + mode.distanceMeters, 0),
          emittedGrams: row.emittedGrams,
          carEquivalentGrams: row.carEquivalentGrams,
          // Même règle que partout ailleurs : un trajet pire que la voiture n'a
          // pas fait économiser « moins que rien ».
          avoidedGrams: Math.max(0, row.carEquivalentGrams - row.emittedGrams),
        };
      }),
      truncated,
    };
  }

  /**
   * Objectif carbone ramené à la période affichée (UF-805).
   *
   * L'usager fixe **un** budget mensuel, comme sur la planche (« Objectif :
   * rester sous 16 kg »). La page se lit sur 7, 30 ou 90 jours : le budget est
   * donc proraté, et la période visée annoncée à l'écran. Trois objectifs
   * indépendants — un par durée — obligeraient à les tenir cohérents entre eux
   * pour ne décrire qu'une seule intention.
   *
   * `usedPercent` n'est **pas** borné à 100 : un dépassement doit se lire comme
   * un dépassement (« 128 % »), pas comme un objectif tout juste tenu. C'est la
   * barre de progression qui se borne à l'affichage, pas le chiffre.
   *
   * @param monthlyGrams Budget mensuel du profil, `null` si aucun n'est fixé
   * @param days Durée de la période affichée
   * @param emittedGrams Émissions déjà constatées sur cette période
   * @returns L'objectif proraté, ou `null` faute d'objectif — jamais un objectif à zéro
   */
  private static buildGoal(
    monthlyGrams: number | null,
    days: CarbonSummaryDays,
    emittedGrams: number,
  ): CarbonGoal | null {
    if (monthlyGrams === null || monthlyGrams <= 0) return null;

    // 30 jours pour « un mois » : c'est la période par défaut de la page, et la
    // seule durée qui fasse du prorata une simple règle de trois.
    const periodGrams = Math.round((monthlyGrams * days) / 30);

    return {
      monthlyGrams,
      periodGrams,
      emittedGrams,
      usedPercent: periodGrams > 0 ? Math.round((emittedGrams / periodGrams) * 100) : 0,
    };
  }

  /**
   * Variation entre deux totaux, en pourcentage entier.
   *
   * `null` quand la référence est nulle : un compte neuf n'a pas « augmenté de
   * l'infini », il n'a simplement rien à comparer — et l'écran le dit alors avec
   * des mots plutôt qu'avec un nombre faux.
   *
   * Arrondi à l'entier : afficher « −76,3 % » sur un barème d'ordre de grandeur
   * suggérerait une précision que le calcul n'a pas.
   */
  private static changePercent(reference: number, value: number): number | null {
    if (reference <= 0) return null;
    return Math.round(((value - reference) / reference) * 100);
  }
}
