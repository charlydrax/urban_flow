// ESLint config for the NestJS API - extends the monorepo strict base (C3).
import baseConfig from '../../eslint.config.base.mjs';

export default [
  ...baseConfig,
  {
    ignores: ['dist/**', 'node_modules/**', 'generated/**'],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Les modules NestJS sont des classes vides décorées (@Module) : motif
      // idiomatique du framework, autorisé comme dans le template officiel Nest
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
];
