import { Injectable } from '@nestjs/common';

import { RouteSegmentDto } from '../routes/dto/itinerary.dto';
import { segmentCarbonGrams } from './emission-factors';

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
 * Service Carbone (fonctionnalité au choix retenue).
 *
 * Autorité unique sur l'empreinte publiée : `computeFootprint` **recalcule**
 * chaque segment à partir de son mode et de sa distance, au lieu de faire
 * confiance à la valeur qu'il porte. Un segment fabriqué par la fusion (UF-401)
 * et un segment venu d'ailleurs sont ainsi valorisés au même barème, et une
 * évolution du barème (`emission-factors.ts`) se propage sans que personne
 * n'ait à ré-émettre ses segments.
 *
 * ⚠️ Le barème reste **provisoire** — ordres de grandeur ADEME, à affiner par un
 * ticket dédié (taux d'occupation réels, mix électrique, VAE). Il classe
 * correctement les modes entre eux, ce qui est ce dont le tri a besoin.
 *
 * Couvre : proposition de valeur écologique du produit ; alimente le tri par
 * CO₂ croissant (étape 9 du flux) et le tableau de bord personnel.
 */
@Injectable()
export class CarbonService {
  /**
   * Calcule l'empreinte carbone d'un itinéraire, segment par segment.
   * Couvre : proposition de valeur écologique ; alimente le tri par CO₂ croissant.
   * @param segments Segments multimodaux de l'itinéraire
   * @returns Empreinte totale en grammes de CO₂
   */
  computeFootprint(segments: RouteSegmentDto[]): number {
    return segments.reduce(
      (total, segment) => total + segmentCarbonGrams(segment.mode, segment.distanceMeters),
      0,
    );
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
