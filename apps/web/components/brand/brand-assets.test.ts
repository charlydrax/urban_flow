import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Recette des fichiers de marque (BUG-004, issue #114).
 *
 * ## Pourquoi tester des images
 *
 * Rien, dans le code, ne casse quand un PNG disparaît : `BrandLockup` rend une
 * balise `<img>` vers une URL, le manifeste cite des chemins en JSON, le
 * service worker précache des chaînes de caractères. Un fichier renommé ou
 * oublié dans un `.gitignore` ne se voit qu'à l'exécution — une icône brisée
 * dans l'onglet, ou pire, une PWA qui s'installe sans icône. C'est exactement le
 * genre de défaut que ce ticket corrigeait ; ce test l'empêche de revenir.
 *
 * Le test lit les **fichiers de déclaration** (manifest, service worker,
 * composant) plutôt qu'une liste recopiée : ajouter une icône au manifeste sans
 * livrer le fichier fait donc échouer la recette, ce qu'une liste en dur
 * n'aurait pas vu.
 *
 * ## Partage des rôles avec `lib/pwa-manifest.test.ts`
 *
 * Celui-ci vérifie le **manifeste** — champs requis par Chrome, scope,
 * couleurs, présence des fichiers cités. Celui-là vérifie les **pixels** : les
 * dimensions réelles correspondent-elles à ce qui est déclaré, la favicon
 * est-elle carrée, les icônes `maskable` sont-elles bien des fichiers distincts.
 * Aucune des deux questions ne se déduit de l'autre.
 *
 * Couvre : C1 (installabilité), C9 (manifeste conforme).
 */

const WEB_ROOT = path.resolve(__dirname, '../..');
const PUBLIC_DIR = path.join(WEB_ROOT, 'public');

/** Lit les 8 premiers octets d'un PNG et en extrait largeur/hauteur (bloc IHDR). */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(path.join(PUBLIC_DIR, file));
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // signature PNG
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('fichiers de marque', () => {
  const manifest = JSON.parse(readFileSync(path.join(PUBLIC_DIR, 'manifest.json'), 'utf8')) as {
    icons: { src: string; sizes: string; purpose: string }[];
  };

  it('livre chaque icône déclarée au manifeste, à la taille annoncée', () => {
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const [declared] = icon.sizes.split(' ');
      const [w, h] = declared.split('x').map(Number);
      // Une icône d'application non carrée est étirée par l'OS au lancement.
      expect(w).toBe(h);
      expect(pngSize(icon.src.replace(/^\//, ''))).toEqual({ width: w, height: h });
    }
  });

  it('distingue les icônes « maskable » des icônes « any »', () => {
    // Une icône `maskable` est rognée en cercle par Android : son contenu doit
    // tenir dans les 80 % centraux. Réutiliser le même fichier pour les deux
    // usages — ce que faisait le manifeste avant BUG-004 — fait couper le logo.
    const any = manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.src);
    const maskable = manifest.icons.filter((i) => i.purpose === 'maskable').map((i) => i.src);

    expect(any.length).toBeGreaterThan(0);
    expect(maskable.length).toBeGreaterThan(0);
    expect(any.filter((src) => maskable.includes(src))).toEqual([]);
  });

  it('sert une favicon .ico carrée — sinon l’onglet l’étire', () => {
    const ico = readFileSync(path.join(PUBLIC_DIR, 'favicon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0); // champ réservé
    expect(ico.readUInt16LE(2)).toBe(1); // type 1 = icône

    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const entry = 6 + 16 * i;
      // 0 encode 256 dans le format ICO ; aucune de nos tailles n'y arrive.
      expect(ico.readUInt8(entry)).toBe(ico.readUInt8(entry + 1));
    }
  });

  it('livre les images citées par le composant de marque', () => {
    const source = readFileSync(path.join(__dirname, 'brand-logo.tsx'), 'utf8');
    const declared = [...source.matchAll(/src: '(\/brand\/[^']+)'/g)].map((m) => m[1]);

    expect(declared).toHaveLength(2);
    for (const src of declared) {
      const { width, height } = pngSize(src.replace(/^\//, ''));
      expect(width).toBeGreaterThan(0);
      // Les dimensions intrinsèques écrites dans le composant réservent la place
      // au chargement (CLS) : fausses, elles décalent la mise en page.
      expect(source).toContain(`width: ${width}, height: ${height}`);
    }
  });

  it('précache la marque et la favicon dans le service worker', () => {
    const sw = readFileSync(path.join(WEB_ROOT, 'sw.ts'), 'utf8');

    for (const asset of ['/favicon.ico', '/brand/logo-urbanflow.png']) {
      expect(sw).toContain(`'${asset}'`);
    }
  });
});
