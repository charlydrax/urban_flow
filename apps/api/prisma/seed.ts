import { PrismaClient } from '@prisma/client';
import { RoutePriority, TransportMode, UserRole } from '@urbanflow/shared';
import * as argon2 from 'argon2';

/**
 * Seed de développement (F1) — jeux de données réalistes pour tester le flux
 * complet (auth → profil → planificateur) sans passer par l'inscription.
 *
 * Sécurité (C4) : les mots de passe sont hachés en argon2, jamais stockés en
 * clair — même dans les données de démo. Idempotent (`upsert` sur l'email) :
 * relançable sans dupliquer ni écraser des comptes réels.
 *
 * ⚠️ À n'exécuter que sur une base de développement (`npm run db:seed`).
 *
 * ## Deux régimes de mots de passe, et pourquoi ils diffèrent (UF-701)
 *
 * Les comptes **usagers** (Marie, PMR) partagent un mot de passe écrit ici :
 * ils n'ouvrent aucun droit particulier, et un identifiant de démonstration
 * public est plus honnête qu'un secret qui n'en est pas un dans un dépôt.
 *
 * Le compte **exploitant** (`admin`), lui, ouvre le mode simulation — donc la
 * capacité de faire compter un trajet qui n'a pas eu lieu. Ses identifiants
 * viennent d'`DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD`, jamais du code : un
 * mot de passe d'administrateur écrit dans un dépôt est un mot de passe connu
 * de tous ceux qui ont lu le dépôt, et le rester après la mise en ligne. Le
 * seed le **journalise sans jamais l'afficher** — email et rôle, rien d'autre
 * (C11).
 */
const prisma = new PrismaClient();

/** Mots de passe de démo — publics par nature (dépôt), donc sans valeur réelle. */
const DEMO_PASSWORD = 'UrbanFlow!2026';

/**
 * Longueur minimale exigée du mot de passe administrateur.
 *
 * Alignée sur `RegisterDto` : le compte le plus privilégié du système n'a
 * aucune raison d'être créé sous une règle plus faible que celle imposée à un
 * usager qui s'inscrit (C4).
 */
const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * Crée ou met à jour le compte de démonstration exploitant (UF-701).
 *
 * ## Idempotence, et ce qu'elle recouvre exactement
 *
 * `upsert` sur l'email, comme les autres comptes — mais le bloc `update` n'est
 * pas vide ici : il **réaffirme le rôle**. Sans cela, un compte créé avant
 * UF-701 sous la même adresse resterait un simple usager après un seed, et le
 * bouton de simulation resterait introuvable sans explication. Le mot de passe,
 * lui, est réécrit à chaque passage : c'est le seul moyen de reprendre la main
 * sur le compte quand on a changé la variable d'environnement.
 *
 * ## Absence de variables : on ne devine pas
 *
 * Sans `DEMO_ADMIN_EMAIL` ni `DEMO_ADMIN_PASSWORD`, le seed **saute** la
 * création et le dit. Il ne se rabat pas sur des valeurs par défaut : un compte
 * administrateur créé au mot de passe deviné par le lecteur du dépôt serait
 * exactement la porte que ce ticket cherche à ne pas ouvrir. Il n'échoue pas
 * non plus — le seed sert d'abord à peupler une base de développement, et
 * l'absence d'outillage de démonstration n'empêche personne de travailler.
 */
async function seedDemoAdmin(): Promise<void> {
  const email = process.env.DEMO_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.DEMO_ADMIN_PASSWORD;

  if (!email || !password) {
    // eslint-disable-next-line no-console
    console.log(
      'Seed: DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD are not set - skipping the admin account.',
    );
    return;
  }

  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    // Échec franc, et seulement ici : la variable est renseignée, donc
    // l'intention est là — c'est la valeur qui ne convient pas, et créer un
    // compte administrateur à mot de passe court serait pire que ne rien créer.
    throw new Error(
      `DEMO_ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters long`,
    );
  }

  const passwordHash = await argon2.hash(password);

  const admin = await prisma.user.upsert({
    where: { email },
    // Réaffirme le rôle ET le mot de passe : voir la docstring.
    update: { passwordHash, role: UserRole.ADMIN },
    create: {
      email,
      passwordHash,
      role: UserRole.ADMIN,
      consentAt: new Date(),
      mobilityProfile: {
        create: {
          preferredModes: [
            TransportMode.METRO,
            TransportMode.BUS,
            TransportMode.TRAM,
            TransportMode.BIKE,
            TransportMode.SCOOTER,
            TransportMode.WALK,
          ],
          priority: RoutePriority.GREENEST,
          reducedMobility: false,
          maxWalkMinutes: 20,
        },
      },
    },
    select: { email: true, role: true },
  });

  // Email et rôle, jamais le mot de passe (C11) — c'est la trace demandée par
  // la recette du ticket, et la seule qu'il soit acceptable d'écrire.
  // eslint-disable-next-line no-console
  console.log('Compte admin créé : %s (role: %s)', admin.email, admin.role);
}

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  // Utilisatrice du scénario nominal (Marie, cf. CLAUDE.md §1) — priorité écolo.
  await prisma.user.upsert({
    where: { email: 'marie@urbanflow.dev' },
    update: {},
    create: {
      email: 'marie@urbanflow.dev',
      passwordHash,
      consentAt: new Date(),
      mobilityProfile: {
        create: {
          preferredModes: [TransportMode.METRO, TransportMode.BIKE, TransportMode.WALK],
          priority: RoutePriority.GREENEST,
          reducedMobility: false,
          maxWalkMinutes: 20,
        },
      },
    },
  });

  // Utilisateur PMR (anticipe C7/C12) — priorité rapide, marche réduite.
  await prisma.user.upsert({
    where: { email: 'pmr@urbanflow.dev' },
    update: {},
    create: {
      email: 'pmr@urbanflow.dev',
      passwordHash,
      consentAt: new Date(),
      mobilityProfile: {
        create: {
          preferredModes: [TransportMode.BUS, TransportMode.TRAM],
          priority: RoutePriority.FASTEST,
          reducedMobility: true,
          maxWalkMinutes: 5,
        },
      },
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    'Seed done: users marie@urbanflow.dev / pmr@urbanflow.dev (password: %s)',
    DEMO_PASSWORD,
  );

  // Le compte exploitant vient après les usagers : c'est un ajout d'outillage,
  // pas une donnée du produit, et son absence ne doit rien empêcher.
  await seedDemoAdmin();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
