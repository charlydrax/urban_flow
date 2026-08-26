import type { Metadata } from 'next';

import { SourceTester } from '../../../features/dev/source-tester';

export const metadata: Metadata = {
  title: 'Diagnostic des sources — UrbanFlow',
  // Page d'outillage : rien à indexer, et surtout rien à faire remonter dans un
  // moteur de recherche (elle n'existe qu'en développement).
  robots: { index: false, follow: false },
};

/**
 * Écran de diagnostic des trois sources (UF-306) — `/dev/sources`.
 *
 * Point de vérification visuelle du Sprint 3 : il déclenche la collecte
 * parallèle (UF-305) et affiche ce que GTFS, GBFS et PostGIS ont réellement
 * répondu, **avant** toute fusion. Une liste d'itinéraires vide ne dit pas si
 * le tort revient à la fusion ou à une source muette ; cet écran, si.
 *
 * ⚠️ **Temporaire**, comme l'endpoint qu'il consomme : il disparaîtra au
 * Sprint 4 quand `/routes/plan` rendra de vrais itinéraires. L'API refuse
 * d'ailleurs de servir le diagnostic hors développement (`404`), ce que l'écran
 * affiche tel quel plutôt que comme une panne.
 *
 * **Privée** : le middleware protège toute page hors `/login` et `/register`
 * (UF-106), et l'API répond `401` sans session valide (recette 2 du ticket).
 *
 * Reste un **Server Component** : seule la sonde elle-même est hydratée (C5).
 */
export default function SourceDiagnosticsPage() {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="sources-title">
        <h1 id="sources-title" className="mb-2 font-display text-2xl font-bold text-primary-dark">
          Diagnostic des sources
        </h1>
        <p className="mb-4 max-w-prose text-sm">
          Interroge les trois sources du planificateur en parallèle et affiche leurs données brutes,
          sans fusion : trajets en transports en commun (GTFS), stations en libre-service (GBFS) et
          tronçons cyclables (PostGIS). Outil de développement — il disparaîtra avec l&apos;arrivée
          des itinéraires réels.
        </p>

        <SourceTester />
      </section>
    </div>
  );
}
