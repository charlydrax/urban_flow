import { defineConfig } from 'vitest/config';

// Tests unitaires des helpers (lib/) — environnement node, rapide (C5).
// Les tests de composants (jsdom + Testing Library) seront ajoutés avec F1/F2.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
});
