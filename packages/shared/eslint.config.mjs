// ESLint du package partagé : réutilise la config stricte du monorepo (C3).
import baseConfig from '../../eslint.config.base.mjs';

export default [...baseConfig, { ignores: ['dist/**'] }];
