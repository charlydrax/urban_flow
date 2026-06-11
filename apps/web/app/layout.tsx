import type { Metadata, Viewport } from 'next';
import Link from 'next/link';

import { ServiceWorkerRegister } from '../components/service-worker-register';
import './globals.css';

export const metadata: Metadata = {
  title: 'UrbanFlow Mobility',
  description:
    'Itinéraires multimodaux (transports en commun, vélo, trottinette, covoiturage) avec empreinte carbone, pour des déplacements urbains plus durables.',
  manifest: '/manifest.json',
  applicationName: 'UrbanFlow Mobility',
  appleWebApp: { capable: true, title: 'UrbanFlow', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#1d6f42',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Layout racine de la PWA — structure sémantique commune à toutes les pages.
 *
 * Couvre :
 * - C7 (WCAG 2.1 AA) : `lang="fr"`, lien d'évitement, landmarks header/nav/main/footer,
 *   focus visible (globals.css), contrastes AA.
 * - C2 : mobile-first (mise en page fluide, viewport configuré).
 * - C1 : manifest lié + enregistrement du service worker.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh bg-surface text-ink antialiased">
        <a href="#contenu" className="skip-link">
          Aller au contenu principal
        </a>

        <header className="border-b border-primary/20 bg-white">
          <nav
            aria-label="Navigation principale"
            className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3"
          >
            <Link href="/" className="text-lg font-bold text-primary-dark">
              UrbanFlow <span className="font-normal">Mobility</span>
            </Link>
            <ul className="flex items-center gap-4 text-sm">
              <li>
                <Link href="/" className="underline-offset-4 hover:underline">
                  Itinéraires
                </Link>
              </li>
              <li>
                <Link href="/" className="underline-offset-4 hover:underline">
                  Mon impact CO₂
                </Link>
              </li>
              <li>
                <Link href="/" className="rounded bg-primary px-3 py-1.5 font-medium text-white">
                  Connexion
                </Link>
              </li>
            </ul>
          </nav>
        </header>

        <main id="contenu" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
          {children}
        </main>

        <footer className="border-t border-primary/20 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-4 text-sm">
            <p>UrbanFlow Mobility — prototype T6 CDSD. </p>
            <Link href="/" className="underline underline-offset-4">
              Politique de confidentialité (RGPD)
            </Link>
          </div>
        </footer>

        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
