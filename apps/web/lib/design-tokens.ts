/**
 * Miroir TypeScript des design tokens CSS (`app/globals.css`, bloc `@theme`),
 * extraits de la maquette Figma « 01 · Charte graphique » (UF-007).
 *
 * Sert aux contextes hors CSS : couleurs des tracés MapLibre (C6),
 * tests de contraste WCAG (C7) et page de démo `/dev/ui` (développement seul).
 * ⚠ Garder synchronisé avec `globals.css` — source visuelle : la maquette Figma.
 */
export const urbanflowColors = {
  /** Vert « Saône » — mobilité douce, actions principales. */
  primary: '#1fa85c',
  /** Vert 700 — texte vert sur fond clair (AAA 7.2:1 sur blanc). */
  primaryDark: '#0e7a3f',
  /** Bleu « Rhône » — transport public, éléments actifs. */
  action: '#1e66e0',
  /** Bleu 700 — texte bleu sur fond clair (AAA 8.4:1 sur blanc). */
  actionDark: '#0e47a8',

  /** Ink 900 — texte principal. */
  ink: '#0a1525',
  /** Ink 700 — texte fort. */
  ink700: '#2c3850',
  /** Ink 500 — texte secondaire. */
  ink500: '#5a6478',
  /** Ink 200 — bordures et séparateurs. */
  ink200: '#e4e8f0',
  /** Placeholders de champs de saisie. */
  placeholder: '#9aa3b5',
  /** Fond de page. */
  surface: '#f6f8fb',
  /**
   * Texte au repos du rail de navigation sombre (UF-803, planche « 03 ·
   * Maquettes desktop »). Ajouté au miroir parce qu'il pose du texte sur Ink 900
   * et non sur blanc : un couple fond/texte absent d'ici est un contraste que
   * personne ne teste.
   */
  railInk: '#c9d2e2',

  /** États système. */
  success: '#0e7a3f',
  warning: '#8a5300',
  error: '#c62828',
  gold: '#9a6a00',

  /**
   * Fonds teintés — bandeaux d'état et badges (bloc « Teintes » de `globals.css`).
   *
   * Ajoutés au miroir par UF-405 : ils ne servaient qu'en CSS jusqu'ici, mais
   * un message d'erreur pose du **texte** dessus, et le couple fond/texte doit
   * alors être vérifié au seuil AA (C7). Un token de fond absent du miroir est
   * un contraste que personne ne teste.
   */
  tintNeutral: '#f1f3f8',
  /**
   * Vert 50 — ajouté au miroir par UF-504 : le badge CO₂ pose du texte
   * `primaryDark` dessus, et un fond de badge absent d'ici est un contraste que
   * personne ne teste.
   */
  tintGreen: '#e8f7ee',
  tintGold: '#fbf3e0',
  tintRed: '#fceaea',

  /** Modes de transport — badges et tracés d'itinéraires sur la carte. */
  modeBike: '#1fa85c',
  modeScooter: '#b85000',
  modeBus: '#1e66e0',
  modeMetro: '#7a2ebf',
  modeTram: '#00746a',
} as const;

/** Convertit une couleur hex `#rrggbb` en canaux RGB 0-255. */
function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** Luminance relative d'une couleur (formule WCAG 2.1). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Ratio de contraste WCAG 2.1 entre deux couleurs hex (`#rrggbb`).
 * Seuils AA (C7) : 4.5:1 pour le texte courant, 3:1 pour le texte large
 * et les composants d'interface.
 * @returns Ratio entre 1 et 21.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}
