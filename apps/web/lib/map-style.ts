import type { StyleSpecification } from 'maplibre-gl';

/**
 * Résolution du fond de carte MapLibre (UF-201).
 *
 * Aucune clé de fournisseur n'est écrite en dur (C4) : le style est déduit des
 * variables d'environnement `NEXT_PUBLIC_*`, inlinées au build par Next.js.
 *
 * Module **pur et sans dépendance runtime à MapLibre** (import de type seulement) :
 * il reste testable dans l'environnement `node` de Vitest, sans DOM ni WebGL.
 *
 * Choix du fournisseur et coûts : `components/map/README.md`.
 */

/**
 * Centre par défaut : Lyon, entre Part-Dieu et Bellecour — les deux extrémités
 * du scénario nominal du projet. Ordre `[lng, lat]` : convention GeoJSON /
 * MapLibre (C9), inverse de l'ordre `lat, lng` de l'API Geolocation.
 */
export const LYON_CENTER: [number, number] = [4.8357, 45.758];

/** Zoom par défaut : échelle « quartiers d'une métropole ». */
export const DEFAULT_ZOOM = 13;

/** Origines contactées pour les tuiles — utile pour documenter/auditer les appels réseau (C8/C11). */
export type MapTileProvider = 'maptiler' | 'custom' | 'osm-raster';

/** Fond de carte résolu, prêt à être passé à `new Map({ style })`. */
export interface ResolvedMapStyle {
  /** URL d'un style vecteur, ou spécification de style inline (repli raster). */
  style: string | StyleSpecification;
  /** Fournisseur effectivement retenu — tracé dans le TSDoc et la doc du module. */
  provider: MapTileProvider;
  /**
   * `true` quand aucune variable n'est configurée : on tourne sur le repli
   * OpenStreetMap, acceptable en développement/démo mais pas en production
   * (politique d'usage des tuiles OSM — voir README du module).
   */
  isFallback: boolean;
}

/**
 * Repli sans clé : tuiles raster OpenStreetMap.
 *
 * Gratuit et sans inscription, mais soumis à la « Tile Usage Policy » de
 * l'OSMF (usage léger uniquement) — c'est un filet de sécurité pour que
 * `npm run dev` fonctionne sans configuration, pas le fond de carte de prod.
 *
 * L'attribution est obligatoire : elle est déclarée sur la source, MapLibre
 * l'affiche alors automatiquement dans son contrôle d'attribution.
 *
 * ⚠️ **Fabrique, et non constante partagée** : MapLibre s'approprie et modifie
 * l'objet de style qu'on lui passe. Réutiliser la même instance d'une carte à
 * l'autre laisse la seconde avec un style déjà consommé — carte vide et
 * silencieuse. Ce cas se produit dès le développement, où `reactStrictMode`
 * monte chaque carte deux fois.
 */
function createOsmRasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      },
    },
    layers: [
      // Fond uni sous les tuiles : évite le flash blanc/transparent pendant le
      // chargement, et reprend le gris bleuté de la maquette (Catskill White).
      { id: 'background', type: 'background', paint: { 'background-color': '#edf1f7' } },
      { id: 'osm-tiles', type: 'raster', source: 'osm' },
    ],
  };
}

/** Variables d'environnement lues par le résolveur (injectées explicitement pour rester testable). */
export interface MapStyleEnv {
  /** URL complète d'un style MapLibre — priorité maximale (tuiles auto-hébergées, métropole…). */
  styleUrl?: string;
  /** Clé du compte MapTiler (jamais commitée — voir `.env.example`). */
  maptilerKey?: string;
}

/** Style MapTiler retenu : `streets-v2`, lisible et neutre sous des tracés colorés. */
const MAPTILER_STYLE = 'streets-v2';

/**
 * Choisit le fond de carte selon l'environnement, par ordre de priorité :
 * 1. `styleUrl` — un style explicite l'emporte toujours (auto-hébergement, autre fournisseur) ;
 * 2. `maptilerKey` — style vecteur MapTiler (offre gratuite, cf. README du module) ;
 * 3. repli raster OpenStreetMap — aucune configuration requise.
 *
 * Fonction pure : aucun accès direct à `process.env`, pour être testable et
 * parce que Next.js n'inline que les accès littéraux `process.env.NEXT_PUBLIC_X`.
 *
 * @param env Valeurs brutes des variables d'environnement (chaînes vides tolérées)
 * @returns Le style à passer à MapLibre, le fournisseur retenu et le drapeau de repli
 */
export function buildMapStyle(env: MapStyleEnv): ResolvedMapStyle {
  const styleUrl = env.styleUrl?.trim();
  if (styleUrl) {
    return { style: styleUrl, provider: 'custom', isFallback: false };
  }

  const key = env.maptilerKey?.trim();
  if (key) {
    // `encodeURIComponent` : la clé arrive d'une variable d'environnement, on ne
    // la concatène pas telle quelle dans une URL (C4 — validation des entrées).
    return {
      style: `https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${encodeURIComponent(key)}`,
      provider: 'maptiler',
      isFallback: false,
    };
  }

  return { style: createOsmRasterStyle(), provider: 'osm-raster', isFallback: true };
}

/**
 * Fond de carte de l'application, lu depuis l'environnement du build Next.js.
 * Couvre : C4 (aucune clé en dur), C10 (fond vecteur léger quand une clé est fournie).
 */
export function getMapStyle(): ResolvedMapStyle {
  return buildMapStyle({
    styleUrl: process.env.NEXT_PUBLIC_MAP_STYLE_URL,
    maptilerKey: process.env.NEXT_PUBLIC_MAPTILER_KEY,
  });
}
