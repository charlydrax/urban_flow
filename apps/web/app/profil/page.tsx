import type { Metadata } from 'next';

import { AccountCard } from '../../features/profile/account-card';
import { DeleteAccountCard } from '../../features/profile/delete-account-card';
import { MobilityProfileForm } from '../../features/profile/mobility-profile-form';

export const metadata: Metadata = {
  title: 'Mon profil — UrbanFlow Mobility',
  description:
    'Consultez et modifiez vos préférences de mobilité : modes de transport acceptés, priorité écologique, accessibilité PMR et consentement à la géolocalisation.',
};

/**
 * Page « Mon profil » (F1, UF-107) — maquette Figma « 3. PROFIL F1 ».
 *
 * **Privée** : aucune déclaration n'est nécessaire ici, le middleware protège
 * toute page hors `/login` et `/register` (UF-106) et l'API refuse en 401 tout
 * appel sans session valide (UF-104). Après déconnexion, cette page redirige
 * donc vers l'écran de connexion (recette 3 du ticket).
 *
 * Depuis UF-603, elle porte aussi les **droits RGPD** de l'utilisateur (C8) :
 * consulter et rectifier ses préférences, retirer son consentement à la
 * géolocalisation, et supprimer son compte. Les trois sont réunis ici parce que
 * c'est l'écran qu'on ouvre quand on se demande « qu'est-ce qu'ils savent de
 * moi ? » — les disperser reviendrait à rendre ces droits théoriques.
 *
 * L'ordre est délibéré : la suppression ferme la page, après les réglages qui
 * suffisent le plus souvent (révoquer la géolocalisation, restreindre les modes).
 *
 * Reste un **Server Component** : elle ne porte que les métadonnées et la mise
 * en page ; seuls les cartes de compte, le formulaire et la zone de suppression
 * sont hydratés (C5, C10).
 */
export default function ProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="profile-title">
        <h1 id="profile-title" className="mb-2 font-display text-2xl font-bold text-primary-dark">
          Mon profil
        </h1>
        <p className="mb-4 max-w-prose">
          Ces préférences pilotent le calcul de vos itinéraires : seuls les modes que vous acceptez
          sont proposés, et les options sont triées selon la priorité choisie.
        </p>

        <div className="flex flex-col gap-4">
          <AccountCard />
          <MobilityProfileForm />
          <DeleteAccountCard />
        </div>
      </section>
    </div>
  );
}
