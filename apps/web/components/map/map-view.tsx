'use client';

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

/** Centre par défaut : Lyon (scénario nominal Part-Dieu → Bellecour). */
const DEFAULT_CENTER: [number, number] = [4.8357, 45.758];
const DEFAULT_ZOOM = 13;

/**
 * Carte MapLibre GL JS de base (F2) — affichera les itinéraires GeoJSON (C9).
 *
 * Toujours chargée via `LazyMap` (lazy-load, C5). Carte vide pour l'instant :
 * les tracés d'itinéraires (LineString renvoyés par l'API) seront ajoutés
 * comme sources/couches GeoJSON lors de l'implémentation F2.
 *
 * Accessibilité (C7) : la carte est décorative/complémentaire — les itinéraires
 * restent disponibles sous forme de liste textuelle (alternative non visuelle).
 */
export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    // Style de démonstration MapLibre (libre) — sera remplacé par un style
    // de tuiles vectorielles de la métropole lors de F2.
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Carte des itinéraires — les résultats sont aussi présentés en liste sous le formulaire"
      className="h-[420px] rounded-lg border border-primary/20"
    />
  );
}
