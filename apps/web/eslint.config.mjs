// ESLint config du client web.
// Étend le preset Next.js (règles React/a11y/Core Web Vitals) via FlatCompat,
// puis applique les mêmes règles strictes que le reste du monorepo (C3).
// NB : la base typescript-eslint du monorepo n'est pas réimportée ici car
// `next/typescript` enregistre déjà le plugin @typescript-eslint (conflit flat config).
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript', 'prettier'),
  {
    ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'next-env.d.ts'],
  },
  {
    rules: {
      // C3 : `any` doit être justifié par un commentaire eslint-disable
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];

export default config;
