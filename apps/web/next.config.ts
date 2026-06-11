import path from 'node:path';

import type { NextConfig } from 'next';

/**
 * Configuration Next.js du client PWA.
 * - `reactStrictMode` : détection précoce des effets de bord (C3).
 * - En-têtes de cache longue durée sur le service worker désactivés : le
 *   navigateur doit revalider sw.js pour récupérer les mises à jour (C1).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Racine du monorepo (un lockfile parasite existe dans le dossier utilisateur)
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
