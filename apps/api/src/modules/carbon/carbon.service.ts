import { Injectable } from '@nestjs/common';
import {
  CARBON_SUMMARY_BUCKETS,
  type CarbonFootprint,
  type CarbonPeriodTotals,
  type CarbonSegmentFootprint,
  type CarbonSummary,
  type CarbonSummaryDays,
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

    const rows = await this.prisma.$queryRaw<CarbonBucketRow[]>`
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
    `;

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
