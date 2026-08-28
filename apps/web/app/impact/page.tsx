import type { Metadata } from 'next';

import { CarbonDashboard } from '../../features/carbon/carbon-dashboard';

export const metadata: Metadata = {
  title: 'Mon impact — UrbanFlow Mobility',
  description:
    'Suivez l’empreinte carbone de vos déplacements : CO₂ émis, CO₂ évité par rapport à la voiture et évolution sur les dernières semaines.',
};

/**
 * Page « Mon impact » (UF-505) — maquette Figma « 8. EMPREINTE CARBONE ».
 *
 * **Privée** : rien à déclarer ici, le middleware protège toute page hors
 * `/login` et `/register` (UF-106) et l'API refuse en 401 tout appel sans
 * session valide (UF-104). Les données affichées sont celles du seul compte
 * connecté — l'API les résout depuis le JWT, aucun identifiant ne transite (C8).
 *
 * Reste un **Server Component** : elle ne porte que les métadonnées et
 * l'introduction ; seul le tableau de bord est hydraté (C5, C10).
 */
export default function ImpactPage() {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="impact-title">
        <h1 id="impact-title" className="mb-2 font-display text-2xl font-bold text-primary-dark">
          Mon impact
        </h1>
        <p className="mb-4 max-w-prose">
          L’empreinte des itinéraires que vous avez retenus, comparée à ce que les mêmes trajets
          auraient coûté seul en voiture.
        </p>

        <CarbonDashboard />
      </section>
    </div>
  );
}
