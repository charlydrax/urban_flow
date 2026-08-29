import path from 'node:path';

import type { NextConfig } from 'next';

import { HSTS_HEADER, STATIC_SECURITY_HEADERS } from './lib/security-headers';

/**
 * Configuration Next.js du client PWA.
 * - `reactStrictMode` : détection précoce des effets de bord (C3).
 * - En-têtes de cache longue durée sur le service worker désactivés : le
 *   navigateur doit revalider sw.js pour récupérer les mises à jour (C1).
 * - En-têtes de sécurité (UF-604, C4) : posés ici plutôt que dans le middleware
 *   pour couvrir **toutes** les réponses, y compris les assets statiques que le
 *   `matcher` du middleware exclut. La CSP, elle, reste dans le middleware :
 *   elle porte un nonce par requête (voir `lib/security-headers.ts`).
 * - `poweredByHeader: false` : `X-Powered-By: Next.js` annonce la techno et sa
 *   famille de CVE à qui scanne. Aucun gain fonctionnel à le publier (OWASP A05).
 * - `distDir` pilotable par l'environnement (UF-605) : voir plus bas.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * Répertoire de sortie du build, surchargeable par `NEXT_DIST_DIR` (UF-605).
   *
   * Par défaut `.next`, comme partout. La surcharge existe pour une raison
   * précise : `npm run build` et `npm run dev` partagent ce répertoire, et un
   * build lancé pendant qu'un serveur de développement tourne lui retire ses
   * chunks sous les pieds (page en 500 jusqu'au redémarrage). Or la mesure du
   * poids des pages doit pouvoir se relancer **à tout moment**, y compris en
   * plein développement — sinon elle ne se relance jamais et le budget dérive.
   *
   * `scripts/eco-budget.mjs` s'en sert pour bâtir dans `.next-eco`, isolé du
   * serveur en cours. Aucun effet sur les builds ordinaires ni sur la CI.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
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
      {
        // Toutes les réponses du front, pages comme fichiers statiques.
        source: '/:path*',
        headers: [
          ...STATIC_SECURITY_HEADERS,
          // HSTS uniquement en production : en dev tout est en HTTP, et un
          // navigateur qui a mémorisé l'en-tête refuse ensuite `http://localhost`.
          ...(process.env.NODE_ENV === 'production' ? [HSTS_HEADER] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
