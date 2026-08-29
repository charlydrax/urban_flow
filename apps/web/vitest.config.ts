import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Deux suites, deux environnements — et c'est volontaire (UF-602).
 *
 * | Suite      | Fichiers      | Env    | Ce qu'elle prouve                          |
 * | ---------- | ------------- | ------ | ------------------------------------------ |
 * | `unit`     | `*.test.ts`   | node   | la logique pure (helpers `lib/`, `features/`) |
 * | `a11y`     | `*.test.tsx`  | jsdom  | le DOM **rendu** passe axe-core (WCAG 2.1 AA) |
 *
 * Garder la suite unitaire en `node` n'est pas une coquetterie : jsdom coûte
 * environ une seconde de démarrage par fichier, et 90 % des tests du projet
 * n'ont jamais eu besoin d'un DOM. Les faire tous passer par jsdom ralentirait
 * la boucle de développement pour rien (C5 — éco-conception jusque dans l'outillage).
 *
 * L'audit d'accessibilité tourne donc **avec** `npm test` : un écart WCAG casse
 * la CI comme un test métier, au lieu d'attendre une passe Lighthouse manuelle
 * que personne ne relance (C7).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ['node_modules', '.next'],
    projects: [
      {
        // Tests unitaires des helpers — environnement node, rapide (C5).
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['**/*.test.ts'],
          exclude: ['node_modules/**', '.next/**'],
        },
      },
      {
        // Audit d'accessibilité sur composants rendus (UF-602, C7).
        extends: true,
        test: {
          name: 'a11y',
          environment: 'jsdom',
          include: ['**/*.test.tsx'],
          exclude: ['node_modules/**', '.next/**'],
          setupFiles: ['./test/setup-a11y.ts'],
        },
      },
    ],
  },
});
