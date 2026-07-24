import { PrismaClient } from '@prisma/client';
import { RoutePriority, TransportMode } from '@urbanflow/shared';
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
 */
const prisma = new PrismaClient();

/** Mots de passe de démo — publics par nature (dépôt), donc sans valeur réelle. */
const DEMO_PASSWORD = 'UrbanFlow!2026';

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
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
