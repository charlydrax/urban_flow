// Shared ESLint base config (flat config) for the whole monorepo.
// Strict mode required by C3 (norms & standards): typescript-eslint "strict" preset,
// no unjustified `any`, Prettier conflicts disabled last.
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  eslintConfigPrettier,
  {
    rules: {
      // C3: `any` must be justified with an eslint-disable comment explaining why
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
