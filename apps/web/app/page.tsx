import { LazyMap } from '../components/map/lazy-map';
import { PlannerForm } from '../features/planner/planner-form';

/**
 * Page d'accueil : planificateur d'itinéraires (F2) au-dessus de la carte.
 * Mobile-first (C2) : formulaire en pleine largeur, carte en dessous ;
 * sur écran large, les deux côte à côte.
 */
export default function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="planner-title">
        <h1 id="planner-title" className="mb-2 text-2xl font-bold text-primary-dark">
          Où allez-vous aujourd&apos;hui&nbsp;?
        </h1>
        <p className="mb-4 max-w-prose">
          Comparez les itinéraires en transports en commun, vélo, trottinette ou covoiturage, triés
          par empreinte carbone croissante.
        </p>
        <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
          <PlannerForm />
          <LazyMap />
        </div>
      </section>
    </div>
  );
}
