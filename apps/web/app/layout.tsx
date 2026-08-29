import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';

import { SiteHeader } from '../components/layout/site-header';
import { OfflineBanner } from '../components/offline/offline-banner';
import { ServiceWorkerRegister } from '../components/service-worker-register';
import { SessionProvider } from '../features/auth/session-provider';
import { getServerSession } from '../lib/session-server';
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
 * - C1/C10 : manifest lié, enregistrement du service worker, et indicateur
 *   global « mode hors-ligne » (UF-601).
 * - C4/C11 (UF-106) : l'état de session est résolu **côté serveur** depuis le
 *   cookie httpOnly et diffusé par `SessionProvider` — aucun token en JS, et
 *   pas de flash « déconnecté » au chargement.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerSession();

  return (
    <html
      lang="fr"
      className={`${plusJakarta.variable} ${bricolage.variable} ${jetbrains.variable}`}
    >
      {/*
        Colonne flex, et pas seulement `min-h-dvh` (UF-606, C2) : le `flex-1`
        que porte `<main>` était inopérant sur un `<body>` en flux normal. Sur
        une page courte — bilan carbone vide, écran de chargement — le pied de
        page remontait donc au milieu de la fenêtre, sous une bande de fond
        vide. Il est désormais poussé en bas.
      */}
      <body className="flex min-h-dvh flex-col bg-surface font-sans text-ink antialiased">
        <SessionProvider initialUser={user}>
          <a href="#contenu" className="skip-link">
            Aller au contenu principal
          </a>

          <SiteHeader />

          {/*
            Indicateur global de perte de connexion (UF-601, C10) : entre
            l'en-tête et le contenu, donc visible dès le premier coup d'oeil sur
            n'importe quelle page, sans recouvrir la navigation.
          */}
          <OfflineBanner />

          {/*
            `max-w-7xl` (1280 px) et non plus `max-w-5xl` (1024 px) — UF-606, C2.

            Les maquettes « 03 · MAQUETTES DESKTOP » sont dessinées à 1440 px et
            posent le planificateur en vue scindée, carte large à droite. Bridée
            à 1024 px, la carte tombait à ~470 px sur un écran de 1440 : plus
            étroite que sur la maquette, alors que c'est l'écran de démonstration.

            Ce plafond est celui des **pages larges** (planificateur, tableau de
            bord carbone). Les pages de lecture et de formulaire — politique de
            confidentialité, profil — reposent leur propre plafond, plus étroit :
            une ligne de texte de 1280 px de long ne se lit pas (C7).
          */}
          <main id="contenu" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
            {children}
          </main>

          <footer className="border-t border-ink-200 bg-white">
            <div className="mx-auto max-w-7xl px-4 py-4 text-sm">
              <p>UrbanFlow Mobility — prototype T6 CDSD. </p>
              {/* UF-603 : la politique de confidentialité est joignable depuis
                  n'importe quelle page, connecté ou non — c'est la condition
                  d'un consentement éclairé (C8). Elle pointait sur `/` en
                  attendant l'écran, livré par ce ticket. */}
              <Link href="/confidentialite" className="underline underline-offset-4">
                Politique de confidentialité (RGPD)
              </Link>
            </div>
          </footer>

          <ServiceWorkerRegister />
        </SessionProvider>
      </body>
    </html>
  );
}
