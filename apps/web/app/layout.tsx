import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import Link from 'next/link';

import { AppNav } from '../components/layout/app-nav';
import { MobileBrandBar } from '../components/layout/mobile-brand-bar';
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
 * - C2 : mobile-first (barre d'onglets basse / rail desktop, viewport configuré).
 * - C1/C10 : manifest lié, enregistrement du service worker, et indicateur
 *   global « mode hors-ligne » (UF-601).
 * - C4/C11 (UF-106) : l'état de session est résolu **côté serveur** depuis le
 *   cookie httpOnly et diffusé par `SessionProvider` — aucun token en JS, et
 *   pas de flash « déconnecté » au chargement.
 *
 * ## Deux colonnes à partir de `lg` (UF-803)
 *
 * La coque passe d'une colonne unique à un **duo rail + contenu** au-delà de
 * 1024 px : `<body>` devient une rangée flex, `AppNav` en occupe la première
 * piste (230 px, cf. planche « 03 · Maquettes desktop ») et tout le reste — barre
 * de marque mobile, bandeau hors-ligne, contenu, pied de page — vit dans la
 * seconde. Sous `lg`, la rangée redevient une colonne et `AppNav` se replie en
 * barre d'onglets fixée en bas de l'écran.
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

        `lg:flex-row` (UF-803) bascule la même coque en deux pistes au-delà de
        1024 px — rail sombre, puis contenu. La colonne intérieure reprend le
        `flex-col` : c'est elle qui pousse maintenant le pied de page en bas.
      */}
      <body className="flex min-h-dvh flex-col bg-surface font-sans text-ink antialiased lg:flex-row">
        <SessionProvider initialUser={user}>
          <a href="#contenu" className="skip-link">
            Aller au contenu principal
          </a>

          {/*
            La navigation est placée **avant** le contenu dans le DOM : c'est
            l'ordre attendu à la tabulation et à la lecture d'écran, quelle que
            soit la position visuelle qu'en donne le CSS (barre du bas sur
            mobile, colonne de gauche sur desktop) — C7, WCAG 1.3.2 / 2.4.3.
            Le lien d'évitement, lui, la précède : c'est sa raison d'être.
          */}
          <AppNav />

          {/*
            Colonne de contenu. `min-w-0` : sans plancher à zéro, une grille ou
            un tableau large de la page repousserait la piste au-delà de la
            fenêtre à côté du rail (le défaut corrigé par UF-606, §1.1).

            `pb-…` réserve la hauteur de la barre d'onglets, qui est en
            `position: fixed` et ne pousse donc rien : sans cette réserve, le
            pied de page et le dernier bouton de chaque écran passeraient
            dessous. La réserve disparaît à `lg`, où le rail est dans le flux.
          */}
          <div className="flex w-full min-w-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
            <MobileBrandBar />

            {/*
              Indicateur global de perte de connexion (UF-601, C10) : en tête de
              la colonne de contenu, donc visible dès le premier coup d'oeil sur
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
          </div>

          <ServiceWorkerRegister />
        </SessionProvider>
      </body>
    </html>
  );
}
