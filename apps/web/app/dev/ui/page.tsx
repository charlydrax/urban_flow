import type { Metadata } from 'next';

import { Badge, type BadgeTone } from '../../../components/ui/badge';
import { Button, type ButtonSize, type ButtonVariant } from '../../../components/ui/button';
import { Card, CardTitle } from '../../../components/ui/card';
import { InputField } from '../../../components/ui/input-field';
import { urbanflowColors } from '../../../lib/design-tokens';

export const metadata: Metadata = {
  title: 'Design system — UrbanFlow',
  robots: { index: false },
};

/** Nuanciers affichés — reprend les cartes de la charte Figma. */
const palettes: { title: string; swatches: { name: string; hex: string; note?: string }[] }[] = [
  {
    title: 'Palette — Primaires',
    swatches: [
      { name: 'Green 500 — Primary', hex: urbanflowColors.primary, note: 'Saône, mobilité douce' },
      { name: 'Green 700 — Texte', hex: urbanflowColors.primaryDark, note: 'AAA 7.2:1' },
      { name: 'Blue 500 — Action', hex: urbanflowColors.action, note: 'Rhône, transport public' },
      { name: 'Blue 700 — Texte', hex: urbanflowColors.actionDark, note: 'AAA 8.4:1' },
    ],
  },
  {
    title: 'Palette — Modes de transport',
    swatches: [
      { name: "Vélo'v / Marche", hex: urbanflowColors.modeBike },
      { name: 'Trottinette', hex: urbanflowColors.modeScooter },
      { name: 'Bus TCL', hex: urbanflowColors.modeBus },
      { name: 'Métro TCL', hex: urbanflowColors.modeMetro },
      { name: 'Tram / TER', hex: urbanflowColors.modeTram },
    ],
  },
  {
    title: 'Palette — Système & gamification',
    swatches: [
      { name: 'Or — Récompenses', hex: urbanflowColors.gold },
      { name: 'Success', hex: urbanflowColors.success },
      { name: 'Warning', hex: urbanflowColors.warning },
      { name: 'Error', hex: urbanflowColors.error },
    ],
  },
  {
    title: 'Neutres — Échelle Ink',
    swatches: [
      { name: 'Ink 900 — Texte principal', hex: urbanflowColors.ink },
      { name: 'Ink 700 — Texte fort', hex: urbanflowColors.ink700 },
      { name: 'Ink 500 — Texte secondaire', hex: urbanflowColors.ink500 },
      { name: 'Ink 200 — Bordures', hex: urbanflowColors.ink200 },
    ],
  },
];

const buttonVariants: ButtonVariant[] = ['primary', 'secondary', 'outline', 'ghost'];
const buttonSizes: ButtonSize[] = ['sm', 'md', 'lg'];

const badgeExamples: { tone: BadgeTone; label: string }[] = [
  { tone: 'neutral', label: 'Neutre' },
  { tone: 'success', label: '✓ Acquis' },
  { tone: 'info', label: 'En cours' },
  { tone: 'reward', label: '★ Récompense' },
  { tone: 'alert', label: '⚠ Perturbation' },
  { tone: 'bike', label: "🚲 Vélo'v" },
  { tone: 'scooter', label: '🛴 Trottinette' },
  { tone: 'bus', label: '🚌 Bus' },
  { tone: 'metro', label: '🚇 Métro' },
  { tone: 'tram', label: '🚊 Tram' },
];

/**
 * Page de démo du design system (UF-007) — vérification visuelle côte à côte
 * avec la maquette Figma « 01 · Charte graphique » : tokens, typographies,
 * composants et leurs états (default, hover, focus visible, disabled, erreur).
 * Page de développement, non indexée et non liée depuis la navigation.
 */
export default function UiKitPage() {
  return (
    <div className="flex flex-col gap-8 pb-8">
      <header>
        <p className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-primary-dark">
          UF-007 · Design system
        </p>
        <h1 className="font-display text-3xl font-extrabold">Charte graphique</h1>
        <p className="mt-1 max-w-prose text-ink-500">
          Tokens et composants extraits de la maquette Figma. Contrastes WCAG 2.1 AA vérifiés par
          <code className="font-mono text-[13px]"> lib/design-tokens.test.ts</code> (C7).
        </p>
      </header>

      <section aria-labelledby="titre-couleurs" className="flex flex-col gap-4">
        <h2 id="titre-couleurs" className="font-display text-xl font-bold">
          Couleurs
        </h2>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {palettes.map((palette) => (
            <Card key={palette.title} className="flex flex-col gap-3">
              <CardTitle>{palette.title}</CardTitle>
              {palette.swatches.map((swatch) => (
                <div key={swatch.name} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="size-11 shrink-0 rounded-md border border-ink/10"
                    style={{ backgroundColor: swatch.hex }}
                  />
                  <span className="flex flex-col">
                    <span className="text-[13px] font-bold">{swatch.name}</span>
                    <span className="font-mono text-[11px] text-ink-500">
                      {swatch.hex.toUpperCase()}
                      {swatch.note ? ` · ${swatch.note}` : ''}
                    </span>
                  </span>
                </div>
              ))}
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="titre-typo" className="flex flex-col gap-4">
        <h2 id="titre-typo" className="font-display text-xl font-bold">
          Typographie
        </h2>
        <Card className="flex max-w-2xl flex-col gap-4">
          <div>
            <p className="font-mono text-[11px] text-ink-500">
              Bricolage Grotesque · Display · 800
            </p>
            <p className="font-display text-4xl font-extrabold">Lyon, repensée.</p>
          </div>
          <div>
            <p className="font-mono text-[11px] text-ink-500">Bricolage Grotesque · H2 · 700</p>
            <p className="font-display text-2xl font-bold">Vos trajets, optimisés en temps réel</p>
          </div>
          <div>
            <p className="font-mono text-[11px] text-ink-500">Plus Jakarta Sans · Body · 400</p>
            <p className="max-w-prose text-[15px]">
              Un itinéraire multimodal personnalisé qui combine Vélo&apos;v, TCL et marche pour
              réduire votre empreinte carbone.
            </p>
          </div>
          <div>
            <p className="font-mono text-[11px] text-ink-500">JetBrains Mono · Code/Data · 500</p>
            <p className="font-mono text-xs font-medium text-ink-700">
              GET /api/routes?from=45.7640,4.8357&amp;to=45.7773,4.8550
            </p>
          </div>
        </Card>
      </section>

      <section aria-labelledby="titre-boutons" className="flex flex-col gap-4">
        <h2 id="titre-boutons" className="font-display text-xl font-bold">
          Boutons — variantes × tailles
        </h2>
        <Card className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            {buttonVariants.map((variant) => (
              <Button key={variant} variant={variant}>
                {variant.charAt(0).toUpperCase() + variant.slice(1)}
              </Button>
            ))}
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {buttonSizes.map((size) => (
              <Button key={size} size={size}>
                {size === 'sm' ? 'Small' : size === 'md' ? 'Medium' : 'Large'}
              </Button>
            ))}
          </div>
          <p className="text-xs text-ink-500">
            Survol : nuance foncée · Focus clavier : outline bleu 3 px (Tab pour tester) ·
            Désactivé : fond Ink 200.
          </p>
        </Card>
      </section>

      <section aria-labelledby="titre-champs" className="flex flex-col gap-4">
        <h2 id="titre-champs" className="font-display text-xl font-bold">
          Champs de saisie
        </h2>
        <Card className="grid max-w-3xl gap-5 sm:grid-cols-2">
          <InputField label="Email" type="email" placeholder="prenom@exemple.fr" />
          <InputField
            label="Départ"
            defaultValue="45.7640, 4.8357"
            hint="Cliquer dans le champ pour voir l'état focus."
          />
          <InputField
            label="Mot de passe"
            type="password"
            defaultValue="1234"
            error="8 caractères minimum requis."
          />
          <InputField label="Champ désactivé" placeholder="Indisponible hors ligne" disabled />
        </Card>
      </section>

      <section aria-labelledby="titre-badges" className="flex flex-col gap-4">
        <h2 id="titre-badges" className="font-display text-xl font-bold">
          Badges — états &amp; modes
        </h2>
        <Card className="flex max-w-3xl flex-wrap gap-2">
          {badgeExamples.map((badge) => (
            <Badge key={badge.tone} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))}
        </Card>
      </section>

      <section aria-labelledby="titre-rayons" className="flex flex-col gap-4">
        <h2 id="titre-rayons" className="font-display text-xl font-bold">
          Rayons &amp; ombres
        </h2>
        <Card className="flex max-w-3xl flex-wrap items-end gap-3">
          {(['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl'] as const).map((radius) => (
            <div
              key={radius}
              className={`flex size-14 items-center justify-center border border-primary/40 bg-tint-green text-[11px] font-bold ${radius}`}
            >
              {radius.replace('rounded-', '')}
            </div>
          ))}
          <div className="flex size-14 items-center justify-center rounded-full bg-white text-[11px] font-bold shadow-raised">
            ∞
          </div>
        </Card>
      </section>
    </div>
  );
}
