/**
 * Contrats du suivi carbone personnel (fonctionnalité retenue).
 */

/** Tableau de bord carbone personnel : impact des déplacements sur une période. */
export interface CarbonDashboard {
  period: { from: string; to: string };
  totalEmittedGrams: number;
  totalAvoidedGrams: number;
  tripsCount: number;
}
