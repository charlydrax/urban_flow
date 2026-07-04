import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Recette UF-006 (C1) — le manifest doit rester valide et installable :
 * champs requis par Chrome pour proposer « Installer l'application »
 * (name, icons 192/512, start_url, display standalone) et icônes maskable
 * déclarées séparément des icônes `any` (recommandation Lighthouse).
 */
interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

interface WebAppManifest {
  name: string;
  short_name: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
}

const manifest = JSON.parse(
  readFileSync(join(__dirname, '..', 'public', 'manifest.json'), 'utf-8'),
) as WebAppManifest;

describe('manifest.json (PWA installable — C1)', () => {
  it('déclare les champs requis pour l’installabilité Chrome', () => {
    expect(manifest.name).toBe('UrbanFlow Mobility');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('reste dans le scope déclaré (start_url ⊆ scope)', () => {
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
  });

  it('déclare des couleurs de thème valides (hex)', () => {
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('fournit les icônes 192 et 512 en purpose any ET maskable', () => {
    for (const purpose of ['any', 'maskable']) {
      for (const size of ['192x192', '512x512']) {
        const icon = manifest.icons.find((i) => i.purpose === purpose && i.sizes === size);
        expect(icon, `icône ${size} (${purpose}) manquante`).toBeDefined();
        expect(icon?.type).toBe('image/png');
      }
    }
  });

  it('pointe vers des fichiers d’icônes existants dans public/', () => {
    for (const icon of manifest.icons) {
      const filePath = join(__dirname, '..', 'public', icon.src);
      expect(() => readFileSync(filePath), `${icon.src} introuvable`).not.toThrow();
    }
  });
});
