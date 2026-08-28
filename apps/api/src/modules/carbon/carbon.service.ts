import { Injectable } from '@nestjs/common';
import type { CarbonFootprint, CarbonSegmentFootprint } from '@urbanflow/shared';

import { RouteSegmentDto } from '../routes/dto/itinerary.dto';
import { GRAMS_PER_PASSENGER_KM, carReferenceGrams, segmentCarbonGrams } from './emission-factors';

/** Tableau de bord carbone personnel exposé par l'API. */
export interface CarbonDashboard {
  /** Période couverte (ISO 8601). */
  period: { from: string; to: string };
  /** Total émis sur la période, en grammes de CO₂. */
  totalEmittedGrams: number;
  /** CO₂ évité par rapport à un trajet tout-voiture équivalent, en grammes. */
  totalAvoidedGrams: number;
  /** Nombre de trajets enregistrés. */
  tripsCount: number;
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
   * Tableau de bord carbone personnel (stub).
   * @param userId Identité issue du JWT (l'utilisateur ne voit que SES données — C8/C11)
   */
  async getDashboard(userId: string): Promise<CarbonDashboard> {
    // TODO(carbone): agrégation de SearchHistory en base pour cet utilisateur
    void userId;
    return {
      period: { from: '2026-06-01', to: '2026-06-30' },
      totalEmittedGrams: 1240,
      totalAvoidedGrams: 8630,
      tripsCount: 12,
    };
  }
}
