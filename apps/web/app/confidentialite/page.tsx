import { SEARCH_HISTORY_RETENTION_MONTHS } from '@urbanflow/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Politique de confidentialité — UrbanFlow Mobility',
  description:
    'Données collectées par UrbanFlow Mobility, finalités, durées de conservation, mesures de protection et exercice de vos droits (RGPD).',
};

/** Une ligne du registre des données collectées — une donnée, une raison, une échéance. */
interface DataRow {
  data: string;
  purpose: string;
  retention: string;
}

/**
 * Registre des traitements, en langage courant.
 *
 * Il ne liste que ce que l'application **stocke réellement** : chaque ligne
 * correspond à une colonne du schéma Prisma. Une politique qui annoncerait des
 * traitements inexistants — ou en oublierait un — serait aussi fautive qu'une
 * politique absente.
 */
const COLLECTED_DATA: DataRow[] = [
  {
    data: 'Adresse e-mail',
    purpose: 'Identifier votre compte et vous permettre de vous connecter.',
    retention: 'Jusqu’à la suppression de votre compte.',
  },
  {
    data: 'Mot de passe',
    purpose:
      'Protéger l’accès à votre compte. Il n’est jamais conservé en clair : seule une empreinte cryptographique (argon2) est stockée, dont votre mot de passe ne peut pas être retrouvé.',
    retention: 'Jusqu’à la suppression de votre compte.',
  },
  {
    data: 'Préférences de mobilité',
    purpose:
      'Adapter vos itinéraires : modes de transport acceptés, priorité rapidité ou écologie, durée de marche maximale.',
    retention: 'Jusqu’à la suppression de votre compte.',
  },
  {
    data: 'Besoin d’itinéraires accessibles (PMR)',
    purpose:
      'Proposer des trajets adaptés lorsque vous l’activez. Cette information touche à votre santé : elle n’est utilisée que pour le calcul d’itinéraire, jamais pour autre chose, et reste facultative.',
    retention: 'Jusqu’à sa désactivation ou la suppression de votre compte.',
  },
  {
    data: 'Position géographique',
    purpose:
      'Pré-remplir votre point de départ et recentrer la carte, uniquement quand vous cliquez sur « Me localiser ».',
    retention:
      'Jamais enregistrée sur nos serveurs. Elle reste dans votre navigateur et disparaît dès que vous fermez l’onglet.',
  },
  {
    data: 'Consentement à la géolocalisation',
    purpose:
      'Prouver que vous avez donné votre accord, et à quelle date — c’est ce qui rend ce consentement vérifiable et révocable.',
    retention: 'Jusqu’à sa révocation ou la suppression de votre compte.',
  },
  {
    data: 'Historique de vos trajets',
    purpose:
      'Vous proposer vos trajets récents et calculer votre bilan carbone personnel (CO₂ émis, CO₂ évité).',
    retention: `${SEARCH_HISTORY_RETENTION_MONTHS} mois, puis suppression automatique.`,
  },
];

/** Une mesure de protection, avec ce qu'elle empêche concrètement. */
interface SafeguardRow {
  measure: string;
  detail: string;
}

const SAFEGUARDS: SafeguardRow[] = [
  {
    measure: 'Chiffrement en transit (HTTPS)',
    detail:
      'Tous les échanges entre votre appareil et nos serveurs sont chiffrés. Le serveur demande en plus à votre navigateur de ne plus jamais nous contacter en clair (en-tête HSTS), ce qui protège même votre toute première visite.',
  },
  {
    measure: 'Session inaccessible aux scripts',
    detail:
      'Votre jeton de connexion est déposé dans un cookie qu’aucun code JavaScript ne peut lire, ce qui le met hors de portée des attaques par injection de script.',
  },
  {
    measure: 'Cloisonnement des comptes',
    detail:
      'Aucune adresse de l’API n’accepte de désigner un autre compte que le vôtre. Vos trajets ne sont pas seulement protégés par un contrôle : il n’existe aucune requête capable de les demander à votre place.',
  },
  {
    measure: 'Journaux sans données personnelles',
    detail:
      'Nos journaux techniques enregistrent des événements et des compteurs, jamais votre e-mail ni vos lieux de départ et d’arrivée.',
  },
  {
    measure: 'Minimisation',
    detail:
      'Nous ne collectons ni nom, ni prénom, ni numéro de téléphone, ni date de naissance : rien de tout cela n’est nécessaire pour calculer un itinéraire.',
  },
];

/**
 * Page « Politique de confidentialité » (UF-603 — C8, recette 2 du ticket).
 *
 * **Publique** : c'est le seul écran de l'application accessible sans session,
 * en dehors de la connexion et de l'inscription. Une politique qu'il faudrait
 * créer un compte pour lire arriverait après la collecte qu'elle est censée
 * expliquer — le consentement ne serait plus éclairé (art. 13 RGPD). Elle reste
 * symétriquement accessible **connecté**, pour qui vient y relire une durée de
 * conservation (voir `isAuthPath` / `OPEN_PATHS` dans `lib/session.ts`).
 *
 * Server Component pur : aucun état, aucun script, aucune hydratation — la page
 * la plus légère de l'application, pour celle qu'on lit le moins souvent (C5).
 *
 * La durée de conservation affichée est importée de `@urbanflow/shared`, d'où la
 * purge automatique côté API tire la sienne : le texte ne peut pas annoncer un
 * délai que le serveur n'applique pas.
 *
 * Accessibilité (C7) : hiérarchie de titres continue (`h1` → `h2` → `h3`),
 * tableaux avec en-têtes portés et `scope`, aucun contenu porté par la couleur
 * seule.
 */
export default function PrivacyPolicyPage() {
  return (
    /*
      Page de lecture : plafond propre à 768 px (UF-606, C2/C7). Le conteneur
      général monte à 1280 px pour les écrans larges du produit ; un texte
      juridique lu de bout en bout n'en veut pas. Les paragraphes portaient déjà
      `max-w-prose`, mais pas les tableaux ni les encadrés de droits, qui
      s'étiraient seuls sur toute la largeur.
    */
    <div className="flex max-w-3xl flex-col gap-8">
      <section aria-labelledby="privacy-title">
        <h1 id="privacy-title" className="mb-2 font-display text-2xl font-bold text-primary-dark">
          Politique de confidentialité
        </h1>
        <p className="max-w-prose text-sm text-ink-700">
          UrbanFlow Mobility calcule des itinéraires multimodaux et leur empreinte carbone. Pour
          cela, l’application traite un petit nombre de données vous concernant. Cette page dit
          lesquelles, pourquoi, combien de temps, et comment reprendre la main.
        </p>
        <p className="mt-2 max-w-prose text-xs text-ink-500">
          Prototype réalisé dans un cadre pédagogique (Titre RNCP 36146 — Concepteur Développeur de
          Solutions Digitales). Les données sont hébergées sur une base de développement et ne sont
          transmises à aucun tiers.
        </p>
      </section>

      <section aria-labelledby="privacy-data-title">
        <h2
          id="privacy-data-title"
          className="mb-3 font-display text-lg font-bold text-primary-dark"
        >
          Ce que nous collectons, et pourquoi
        </h2>
        {/* `overflow-x-auto` : sur mobile, le tableau défile dans son cadre plutôt
            que de faire déborder la page entière (C2). */}
        <div className="overflow-x-auto rounded-lg border border-ink-200 bg-white">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Données collectées par UrbanFlow Mobility, finalité de chaque donnée et durée de
              conservation
            </caption>
            <thead className="bg-tint-neutral">
              <tr>
                <th scope="col" className="p-3 font-bold text-ink">
                  Donnée
                </th>
                <th scope="col" className="p-3 font-bold text-ink">
                  Pourquoi elle est collectée
                </th>
                <th scope="col" className="p-3 font-bold text-ink">
                  Combien de temps
                </th>
              </tr>
            </thead>
            <tbody>
              {COLLECTED_DATA.map((row) => (
                <tr key={row.data} className="border-t border-ink-200 align-top">
                  <th scope="row" className="p-3 font-bold text-ink">
                    {row.data}
                  </th>
                  <td className="p-3 text-ink-700">{row.purpose}</td>
                  <td className="p-3 text-ink-700">{row.retention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="privacy-geoloc-title">
        <h2
          id="privacy-geoloc-title"
          className="mb-3 font-display text-lg font-bold text-primary-dark"
        >
          Votre position : consentement d’abord
        </h2>
        <div className="max-w-prose space-y-3 text-sm text-ink-700">
          <p>
            L’application ne demande jamais votre position au chargement d’une page. Elle ne la
            demande qu’au moment où vous cliquez sur <strong>« Me localiser »</strong>, et la toute
            première fois, un panneau vous explique l’usage prévu avant que la moindre demande ne
            parte vers votre navigateur.
          </p>
          <p>
            Votre accord est <strong>horodaté et enregistré</strong> sur nos serveurs : il est donc
            vérifiable, et vous pouvez le retirer à tout moment depuis votre profil. Un refus, lui,
            n’enregistre rien du tout.
          </p>
          <p>
            Vos coordonnées ne quittent jamais votre navigateur : elles servent à remplir le champ «
            Départ » et à centrer la carte, puis disparaissent. Ce que nous conservons, ce sont les
            <strong> trajets que vous avez recherchés</strong>, pas la trace de vos déplacements
            minute par minute. L’application ne suit jamais votre position en continu.
          </p>
        </div>
      </section>

      <section aria-labelledby="privacy-rights-title">
        <h2
          id="privacy-rights-title"
          className="mb-3 font-display text-lg font-bold text-primary-dark"
        >
          Vos droits, et où les exercer
        </h2>
        <ul className="max-w-prose space-y-3 text-sm text-ink-700">
          <li>
            <strong className="text-ink">Accès et rectification</strong> — votre e-mail, la date de
            votre consentement et vos préférences sont affichés et modifiables depuis la page{' '}
            <Link href="/profil" className="underline underline-offset-4">
              Mon profil
            </Link>
            .
          </li>
          <li>
            <strong className="text-ink">Retrait du consentement</strong> — l’interrupteur «
            géolocalisation » de votre profil retire votre accord et efface la date enregistrée.
            L’application reste entièrement utilisable : la saisie manuelle d’une adresse ne dépend
            d’aucun consentement.
          </li>
          <li>
            <strong className="text-ink">Effacement</strong> — le bouton « Supprimer mon compte »,
            en bas de votre profil, efface définitivement votre compte, vos préférences et
            l’intégralité de votre historique de trajets. La suppression est immédiate et
            irréversible : rien n’est conservé « au cas où », pas même une ligne anonymisée.
          </li>
          <li>
            <strong className="text-ink">Limitation de la conservation</strong> — vos trajets de
            plus de {SEARCH_HISTORY_RETENTION_MONTHS} mois sont supprimés automatiquement, chaque
            nuit, sans que vous ayez à le demander.
          </li>
        </ul>
      </section>

      <section aria-labelledby="privacy-safeguards-title">
        <h2
          id="privacy-safeguards-title"
          className="mb-3 font-display text-lg font-bold text-primary-dark"
        >
          Comment vos données sont protégées
        </h2>
        <dl className="max-w-prose space-y-3 text-sm">
          {SAFEGUARDS.map((item) => (
            <div key={item.measure}>
              <dt className="font-bold text-ink">{item.measure}</dt>
              <dd className="text-ink-700">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="privacy-contact-title">
        <h2
          id="privacy-contact-title"
          className="mb-3 font-display text-lg font-bold text-primary-dark"
        >
          Une question, une réclamation
        </h2>
        <p className="max-w-prose text-sm text-ink-700">
          Pour toute question sur vos données, écrivez à{' '}
          <a href="mailto:contact@urbanflow.example" className="underline underline-offset-4">
            contact@urbanflow.example
          </a>
          . Vous pouvez également introduire une réclamation auprès de la CNIL, l’autorité française
          de protection des données.
        </p>
      </section>
    </div>
  );
}
