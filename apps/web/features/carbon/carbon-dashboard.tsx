import { formatCarbon } from '../../lib/format-carbon';

/**
 * Tableau de bord carbone personnel — STUB squelette avec données factices.
 *
 * Implémentation cible : `apiClient.getCarbonDashboard()` (données réelles
 * agrégées depuis l'historique des trajets), graphique d'évolution accessible
 * (alternative tabulaire — C7).
 */
export function CarbonDashboard() {
  // TODO(carbone): remplacer par apiClient.getCarbonDashboard()
  const mock = { totalEmittedGrams: 1240, totalAvoidedGrams: 8630, tripsCount: 12 };

  return (
    <section
      aria-labelledby="carbon-title"
      className="rounded-lg border border-primary/20 bg-white p-4"
    >
      <h2 id="carbon-title" className="mb-3 text-lg font-bold text-primary-dark">
        Mon impact ce mois-ci
      </h2>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm">CO₂ émis</dt>
          <dd className="text-xl font-bold">{formatCarbon(mock.totalEmittedGrams)}</dd>
        </div>
        <div>
          <dt className="text-sm">CO₂ évité</dt>
          <dd className="text-xl font-bold text-primary">{formatCarbon(mock.totalAvoidedGrams)}</dd>
        </div>
        <div>
          <dt className="text-sm">Trajets</dt>
          <dd className="text-xl font-bold">{mock.tripsCount}</dd>
        </div>
      </dl>
    </section>
  );
}
