// ESLint config du client web.
// Étend le preset Next.js (règles React/a11y/Core Web Vitals) via FlatCompat,
// puis applique les mêmes règles strictes que le reste du monorepo (C3).
// NB : la base typescript-eslint du monorepo n'est pas réimportée ici car
// `next/typescript` enregistre déjà le plugin @typescript-eslint (conflit flat config).
import { FlatCompat } from '@eslint/eslintrc';
import jsxA11y from 'eslint-plugin-jsx-a11y';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript', 'prettier'),

  /*
   * Accessibilité (UF-602, C7) — le jeu **strict** de `jsx-a11y`, pas celui que
   * `next/core-web-vitals` active par défaut.
   *
   * Next n'en retient qu'une douzaine de règles ; le preset strict en apporte
   * une trentaine, dont celles qui comptent le plus ici : `label-has-associated
   * -control` (un `<label>` doit envelopper ou viser un contrôle),
   * `no-noninteractive-element-to-interactive-role`, `aria-*` complets.
   *
   * C'est l'étage **statique** de l'audit : ESLint voit le JSX avant qu'il soit
   * rendu, axe voit le DOM après. Les deux sont nécessaires — ESLint ne peut
   * rien dire d'un `aria-describedby` qui pointe vers un `id` absent au runtime,
   * axe ne peut rien dire d'une branche jamais rendue par un test.
   *
   * Seules les **règles** du preset sont reprises, pas sa clé `plugins` :
   * `next/core-web-vitals` a déjà enregistré `jsx-a11y`, et le réenregistrer
   * fait échouer ESLint (« Cannot redefine plugin »).
   */
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,

      /*
       * Deux règles sont **reparamétrées**, jamais désactivées : dans les deux
       * cas le défaut de la règle est plus étroit que la norme, et l'écarter
       * silencieusement reviendrait à laisser un vrai défaut passer plus tard
       * sous le même prétexte.
       */

      /*
       * Le patron « combobox » du WAI-ARIA Authoring Practices est écrit avec
       * `<ul role="listbox">` / `<li role="option">` — c'est le balisage de
       * `address-autocomplete.tsx`. La règle refuse par défaut tout rôle
       * interactif sur une liste ; on lui déclare donc les deux seules
       * associations que la norme recommande, et rien d'autre.
       */
      'jsx-a11y/no-noninteractive-element-to-interactive-role': [
        'error',
        { ul: ['listbox'], li: ['option'] },
      ],

      /*
       * `label-has-associated-control` ne descend que de deux niveaux dans le
       * JSX pour trouver le texte d'une étiquette. Nos étiquettes de profil
       * empilent un titre et son explication (`label > span > span`), soit
       * trois. Le texte est bien là — axe le confirme en lisant le DOM rendu
       * (`profile.a11y.test.tsx`) : c'est la profondeur d'analyse qu'il faut
       * corriger, pas le balisage.
       */
      'jsx-a11y/label-has-associated-control': ['error', { depth: 3 }],
    },
  },

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
