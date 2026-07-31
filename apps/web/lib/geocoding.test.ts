import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BAN_SEARCH_URL,
  buildReverseUrl,
  buildSearchUrl,
  isWithinLyonArea,
  LYON_BIAS,
  MIN_QUERY_LENGTH,
  normalizeFeature,
  reverseGeocode,
  searchAddresses,
  SEARCH_FETCH_LIMIT,
  SUGGESTION_LIMIT,
} from './geocoding';

/**
 * Recette UF-203, versant module pur :
 * - la requête envoyée à la BAN est bien celle attendue (autocomplétion + biais Lyon) ;
 * - une saisie trop courte ne déclenche **aucun** appel réseau (C5) ;
 * - les résultats hors métropole sont écartés (« restreindre à la zone de Lyon ») ;
 * - la sélection expose bien `{ label, lat, lng }` dans le bon ordre (C9) ;
 * - aucune panne du service ne lève d'exception jusqu'à l'UI.
 *
 * `fetch` est simulé : ces tests tournent dans l'environnement `node` de Vitest,
 * sans réseau — la CI ne dépend donc pas de la disponibilité de la BAN.
 */

/** Fabrique une entité GeoJSON conforme à ce que renvoie la BAN. */
function banFeature({
  id = '69382_8078_00014',
  label = '14 Rue de la République 69002 Lyon',
  lat = 45.7639,
  lng = 4.8357,
  context = '69, Rhône, Auvergne-Rhône-Alpes',
  district,
}: {
  id?: string;
  label?: string;
  lat?: number;
  lng?: number;
  context?: string;
  district?: string;
} = {}) {
  return {
    type: 'Feature',
    // GeoJSON : [lng, lat] — l'inverse de l'ordre courant (C9).
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { id, label, context, district, city: 'Lyon' },
  };
}

/** Installe un `fetch` qui répond une collection d'entités BAN. */
function mockFetchFeatures(features: unknown[]) {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ type: 'FeatureCollection', features }),
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildSearchUrl', () => {
  it('demande l’autocomplétion, plafonne les résultats et biaise sur Lyon', () => {
    const url = new URL(buildSearchUrl('république'));

    expect(`${url.origin}${url.pathname}`).toBe(BAN_SEARCH_URL);
    expect(url.searchParams.get('q')).toBe('république');
    expect(url.searchParams.get('autocomplete')).toBe('1');
    expect(url.searchParams.get('lat')).toBe(String(LYON_BIAS.lat));
    expect(url.searchParams.get('lon')).toBe(String(LYON_BIAS.lng));
  });

  it('demande plus de candidats qu’il n’en sera affiché, pour survivre au filtre lyonnais', () => {
    const url = new URL(buildSearchUrl('bellecour'));

    expect(url.searchParams.get('limit')).toBe(String(SEARCH_FETCH_LIMIT));
    expect(SEARCH_FETCH_LIMIT).toBeGreaterThan(SUGGESTION_LIMIT);
  });

  it('encode la saisie plutôt que de la concaténer (pas d’injection dans l’URL — C4)', () => {
    const url = new URL(buildSearchUrl('rue de l’Égalité & co'));
    expect(url.searchParams.get('q')).toBe('rue de l’Égalité & co');
  });
});

describe('buildReverseUrl', () => {
  it('transmet lat/lon sans inverser les axes', () => {
    const url = new URL(buildReverseUrl(45.76045, 4.85949));
    expect(url.searchParams.get('lat')).toBe('45.76045');
    expect(url.searchParams.get('lon')).toBe('4.85949');
  });
});

describe('isWithinLyonArea', () => {
  it('accepte le centre de Lyon et les communes de la métropole', () => {
    expect(isWithinLyonArea(45.7605, 4.8595)).toBe(true); // Part-Dieu
    expect(isWithinLyonArea(45.7719, 4.8902)).toBe(true); // Villeurbanne
    expect(isWithinLyonArea(45.6969, 4.8859)).toBe(true); // Vénissieux
  });

  it('écarte les homonymes lointains', () => {
    expect(isWithinLyonArea(48.8566, 2.3522)).toBe(false); // Paris
    expect(isWithinLyonArea(43.2965, 5.3698)).toBe(false); // Marseille
  });
});

describe('normalizeFeature', () => {
  it('replace les coordonnées GeoJSON [lng, lat] dans le bon sens (C9)', () => {
    const place = normalizeFeature(banFeature({ lat: 45.7639, lng: 4.8357 }));

    expect(place).not.toBeNull();
    expect(place?.lat).toBe(45.7639);
    expect(place?.lng).toBe(4.8357);
  });

  it('préfère l’arrondissement au contexte administratif verbeux', () => {
    const place = normalizeFeature(banFeature({ district: 'Lyon 2e Arrondissement' }));
    expect(place?.context).toBe('Lyon 2e Arrondissement');
  });

  it('retombe sur le département seul quand l’arrondissement manque', () => {
    const place = normalizeFeature(banFeature({ context: '69, Rhône, Auvergne-Rhône-Alpes' }));
    expect(place?.context).toBe('Rhône');
  });

  it('rejette une entité sans coordonnées exploitables plutôt que de produire un NaN', () => {
    expect(
      normalizeFeature({ geometry: { coordinates: [] }, properties: { label: 'x' } }),
    ).toBeNull();
    expect(
      normalizeFeature({ geometry: { coordinates: ['4.8', '45.7'] }, properties: { label: 'x' } }),
    ).toBeNull();
    expect(normalizeFeature({ properties: { label: 'x' } })).toBeNull();
  });

  it('rejette une entité sans libellé affichable', () => {
    expect(
      normalizeFeature({ geometry: { coordinates: [4.83, 45.76] }, properties: {} }),
    ).toBeNull();
  });
});

describe('searchAddresses', () => {
  it('n’appelle pas le réseau sous la longueur minimale (C5)', async () => {
    const fetchSpy = mockFetchFeatures([]);

    const result = await searchAddresses('re');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, places: [] });
    expect(MIN_QUERY_LENGTH).toBe(3);
  });

  it('renvoie les suggestions avec leurs coordonnées (recette 2)', async () => {
    mockFetchFeatures([
      banFeature({ label: '14 Rue de la République 69002 Lyon', lat: 45.7639, lng: 4.8357 }),
    ]);

    const result = await searchAddresses('république');

    expect(result).toEqual({
      ok: true,
      places: [
        {
          id: '69382_8078_00014',
          label: '14 Rue de la République 69002 Lyon',
          context: 'Rhône',
          lat: 45.7639,
          lng: 4.8357,
        },
      ],
    });
  });

  it('écarte les résultats hors métropole (restriction demandée par le ticket)', async () => {
    mockFetchFeatures([
      banFeature({
        id: 'lyon',
        label: 'Place de la République 69002 Lyon',
        lat: 45.7639,
        lng: 4.8357,
      }),
      banFeature({
        id: 'paris',
        label: 'Place de la République 75011 Paris',
        lat: 48.8674,
        lng: 2.3636,
      }),
    ]);

    const result = await searchAddresses('république');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.places).toHaveLength(1);
    expect(result.places[0].id).toBe('lyon');
  });

  it('ne rend jamais plus de suggestions que la liste n’en affiche', async () => {
    // La BAN a renvoyé les 10 candidats demandés, tous lyonnais : on n'en garde
    // que le haut du panier, sans perdre l'ordre de pertinence.
    mockFetchFeatures(
      Array.from({ length: SEARCH_FETCH_LIMIT }, (_unused, index) =>
        banFeature({ id: `lyon-${index}`, label: `Rue ${index} 69002 Lyon` }),
      ),
    );

    const result = await searchAddresses('rue');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.places).toHaveLength(SUGGESTION_LIMIT);
    expect(result.places[0].id).toBe('lyon-0');
  });

  it('signale une panne du service sans lever d’exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(searchAddresses('république')).resolves.toEqual({ ok: false, reason: 'service' });
  });

  it('signale une réponse illisible comme une panne du service', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(new Error('bad json')) }),
    );

    await expect(searchAddresses('république')).resolves.toEqual({ ok: false, reason: 'service' });
  });

  it('signale une coupure réseau comme telle (mode hors ligne — C10)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(searchAddresses('république')).resolves.toEqual({ ok: false, reason: 'network' });
  });

  it('distingue une requête annulée d’une panne : une frappe n’est pas un incident', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        controller.abort();
        return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
      }),
    );

    await expect(searchAddresses('république', controller.signal)).resolves.toEqual({
      ok: false,
      reason: 'aborted',
    });
  });
});

describe('reverseGeocode', () => {
  it('renvoie l’adresse la plus proche des coordonnées', async () => {
    mockFetchFeatures([banFeature({ label: '14 Rue de la République 69002 Lyon' })]);

    const place = await reverseGeocode(45.7639, 4.8357);

    expect(place?.label).toBe('14 Rue de la République 69002 Lyon');
  });

  it('renvoie null sur échec : l’adresse est un bonus, jamais un prérequis', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(reverseGeocode(45.7639, 4.8357)).resolves.toBeNull();
  });

  it('renvoie null quand aucune adresse ne correspond (pleine campagne, plan d’eau)', async () => {
    mockFetchFeatures([]);

    await expect(reverseGeocode(45.7639, 4.8357)).resolves.toBeNull();
  });
});
