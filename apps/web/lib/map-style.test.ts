import { describe, expect, it } from 'vitest';

import { DEFAULT_ZOOM, LYON_CENTER, buildMapStyle } from './map-style';

/**
 * Recette UF-201 : « la clé du fournisseur de tuiles est en variable
 * d'environnement, pas en dur ». Ces tests verrouillent la règle de résolution
 * du fond de carte et le fait qu'aucune clé ne soit codée dans le dépôt.
 */
describe('buildMapStyle', () => {
  it('replie sur les tuiles raster OpenStreetMap quand rien n’est configuré', () => {
    const resolved = buildMapStyle({});

    expect(resolved.provider).toBe('osm-raster');
    expect(resolved.isFallback).toBe(true);
    expect(typeof resolved.style).toBe('object');
  });

  it('déclare l’attribution OpenStreetMap sur le style de repli (obligation légale)', () => {
    const resolved = buildMapStyle({});
    const style = resolved.style as { sources: Record<string, { attribution?: string }> };

    expect(style.sources.osm.attribution).toContain('OpenStreetMap');
  });

  it('construit l’URL MapTiler à partir de la clé fournie', () => {
    const resolved = buildMapStyle({ maptilerKey: 'test-key-123' });

    expect(resolved.provider).toBe('maptiler');
    expect(resolved.isFallback).toBe(false);
    expect(resolved.style).toBe(
      'https://api.maptiler.com/maps/streets-v2/style.json?key=test-key-123',
    );
  });

  it('échappe la clé avant de l’injecter dans l’URL (C4)', () => {
    const resolved = buildMapStyle({ maptilerKey: 'a b&c=d' });

    expect(resolved.style).toBe(
      'https://api.maptiler.com/maps/streets-v2/style.json?key=a%20b%26c%3Dd',
    );
  });

  it('donne la priorité à une URL de style explicite sur la clé MapTiler', () => {
    const resolved = buildMapStyle({
      styleUrl: 'https://tuiles.grandlyon.fr/style.json',
      maptilerKey: 'test-key-123',
    });

    expect(resolved.provider).toBe('custom');
    expect(resolved.style).toBe('https://tuiles.grandlyon.fr/style.json');
  });

  it('renvoie un objet de style neuf à chaque appel (MapLibre s’approprie le style)', () => {
    const first = buildMapStyle({});
    const second = buildMapStyle({});

    // Deux cartes montées successivement (StrictMode, navigation entre écrans)
    // ne doivent jamais partager le même objet : la seconde recevrait un style
    // déjà consommé par la première et resterait vide.
    expect(first.style).not.toBe(second.style);
    expect(first.style).toEqual(second.style);
  });

  it('traite les variables vides ou blanches comme non renseignées', () => {
    expect(buildMapStyle({ styleUrl: '   ', maptilerKey: '' }).provider).toBe('osm-raster');
    expect(buildMapStyle({ maptilerKey: '  ' }).provider).toBe('osm-raster');
  });
});

describe('vue par défaut', () => {
  it('centre la carte sur Lyon en [lng, lat] (convention GeoJSON — C9)', () => {
    const [lng, lat] = LYON_CENTER;

    // Lyon : ~45.75 N, ~4.85 E — l'inversion des deux placerait la carte en Somalie.
    expect(lat).toBeGreaterThan(45.7);
    expect(lat).toBeLessThan(45.8);
    expect(lng).toBeGreaterThan(4.8);
    expect(lng).toBeLessThan(4.9);
  });

  it('utilise un zoom d’échelle « quartier »', () => {
    expect(DEFAULT_ZOOM).toBe(13);
  });
});
