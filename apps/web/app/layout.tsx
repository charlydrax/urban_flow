import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';

import { SiteHeader } from '../components/layout/site-header';
import { ServiceWorkerRegister } from '../components/service-worker-register';
import './globals.css';

/*
 * Typographies de la charte Figma (UF-007), self-hostées par next/font :
 * aucune requête vers un CDN tiers au runtime (C5 éco-conception, C10 perfs,
 * RGPD — pas de fuite d'IP vers Google Fonts).
 */
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'UrbanFlow Mobility',
  description:
    'Itinéraires multimodaux (transports en commun, vélo, trottinette, covoiturage) avec empreinte carbone, pour des déplacements urbains plus durables.',
  manifest: '/manifest.json',
  applicationName: 'UrbanFlow Mobility',
  appleWebApp: { capable: true, title: 'UrbanFlow', statusBarStyle: 'default' },
  // iOS ignore les icônes du manifest : apple-touch-icon requis pour l'écran d'accueil (C1)
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  // Vert « Saône » primaire de la charte Figma — synchronisé avec manifest.json (C1)
  themeColor: '#1fa85c',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Layout racine de la PWA — structure sémantique commune à toutes les pages.
 *
 * Couvre :
 * - C7 (WCAG 2.1 AA) : `lang="fr"`, lien d'évitement, landmarks header/nav/main/footer,
 *   focus visible (globals.css), contrastes AA (vérifiés par lib/design-tokens.test.ts).
 * - C2 : mobile-first (navigation repliable, viewport configuré).
 * - C1 : manifest lié + enregistrement du service worker.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${plusJakarta.variable} ${bricolage.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-dvh bg-surface font-sans text-ink antialiased">
        <a href="#contenu" className="skip-link">
          Aller au contenu principal
        </a>

        <SiteHeader />

        <main id="contenu" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
          {children}
        </main>

        <footer className="border-t border-ink-200 bg-white">
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
