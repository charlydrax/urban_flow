'use client';

import {
  GeolocateControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type ErrorEvent as MapLibreErrorEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { formatAccuracy, toLngLat, type UserPosition } from '../../lib/geolocation';
import { DEFAULT_ZOOM, LYON_CENTER, getMapStyle } from '../../lib/map-style';

/**
 * Libellés MapLibre en français (C7 — WCAG 3.1.1 « Langue de la page »).
 *
 * La bibliothèque étiquette ses propres contrôles en anglais : sans ce patch,
 * un lecteur d'écran francophone annoncerait « Zoom in » au milieu d'une
 * interface française. `Map.Title` est ajouté à la volée depuis `ariaLabel`.
 */
const MAPLIBRE_LOCALE_FR: Record<string, string> = {
  'NavigationControl.ZoomIn': 'Zoomer',
  'NavigationControl.ZoomOut': 'Dézoomer',
  'NavigationControl.ResetBearing': "Réinitialiser l'orientation",
  'GeolocateControl.FindMyLocation': 'Me localiser',
  'GeolocateControl.LocationNotAvailable': 'Position indisponible',
  'AttributionControl.ToggleAttribution': 'Afficher les mentions du fond de carte',
  'AttributionControl.MapFeedback': 'Signaler une erreur de carte',
  'ScaleControl.Meters': 'm',
  'ScaleControl.Kilometers': 'km',
  'FullscreenControl.Enter': 'Passer en plein écran',
  'FullscreenControl.Exit': 'Quitter le plein écran',
};

export interface MapViewProps {
  /** Centre de la carte en `[lng, lat]` (convention GeoJSON — C9). Défaut : Lyon. */
  center?: [number, number];
  /** Niveau de zoom initial. Défaut : 13 (échelle quartier). */
  zoom?: number;
  /** Classes de la boîte englobante — c'est l'appelant qui fixe la hauteur. */
  className?: string;
  /** Description de la carte pour les lecteurs d'écran (C7). */
  ariaLabel?: string;
  /** Alternative textuelle : où retrouver la même information sans la carte (C7). */
  textAlternative?: string;
  /**
   * Position de l'utilisateur à matérialiser sur la carte (UF-202).
   * `null`/absent : aucun marqueur — la carte reste centrée sur sa ville par défaut.
   */
  userPosition?: UserPosition | null;
  /**
   * Contrôle « Me localiser » natif de MapLibre (C6).
   *
   * **Désactivé par défaut depuis UF-202** : ce bouton appelle directement
   * l'API Geolocation, sans passer par le consentement tracé côté serveur. Il
   * ne convient donc qu'aux écrans où aucun parcours consenti n'est proposé.
   * Sur le planificateur, c'est `useUserLocation` qui pilote la demande.
   */
  showGeolocateControl?: boolean;
  /**
   * Appelé une fois la carte prête (`load`). Point d'extension prévu pour F2 :
   * ajout des sources/couches GeoJSON des itinéraires.
   * @param map Instance MapLibre — ne pas conserver après le démontage
   */
  onReady?: (map: MapLibreMap) => void;
  /** Surcouches positionnées au-dessus de la carte (légende, badges…). */
  children?: ReactNode;
}

/**
 * Carte MapLibre GL JS réutilisable (UF-201) — brique de base du planificateur (F2).
 *
 * À charger **exclusivement** via `LazyMap` : MapLibre a besoin du DOM et du
 * WebGL, un rendu serveur planterait sur `window is not defined`.
 *
 * Le fond de carte vient de `lib/map-style` (clé du fournisseur en variable
 * d'environnement — C4) ; l'instance est créée une seule fois puis pilotée par
 * caméra, et intégralement détruite au démontage (pas de fuite mémoire, C5).
 *
 * Accessibilité (C7) : la carte est une **région étiquetée** (posée par MapLibre
 * sur son canvas, avec notre libellé) — et non un `role="img"`, qui rendrait les
 * boutons de zoom invisibles aux technologies d'assistance. Elle est doublée
 * d'une alternative textuelle renvoyant vers l'équivalent non visuel, et les
 * libellés des contrôles sont traduits en français.
 *
 * Géolocalisation (UF-202) : la carte se contente d'**afficher** ce qu'on lui
 * donne (`userPosition`, `center`). Elle ne demande jamais la position d'elle-même
 * — le consentement et la demande de permission sont l'affaire de l'écran hôte.
 */
export function MapView({
  center = LYON_CENTER,
  zoom = DEFAULT_ZOOM,
  className = '',
  ariaLabel = 'Carte des itinéraires',
  textAlternative = 'Les itinéraires sont également présentés sous forme de liste textuelle.',
  userPosition = null,
  showGeolocateControl = false,
  onReady,
  children,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [hasStyleError, setHasStyleError] = useState(false);

  // `onReady` passe par une ref : une fonction recréée à chaque rendu par
  // l'appelant ne doit pas provoquer la reconstruction de la carte.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Valeurs initiales figées : les changements ultérieurs passent par la caméra
  // (effet suivant), pas par une nouvelle instance.
  const initialViewRef = useRef({ center, zoom, ariaLabel });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const map = new MapLibreMap({
      container,
      style: getMapStyle().style,
      center: initialViewRef.current.center,
      zoom: initialViewRef.current.zoom,
      // Attribution obligatoire des fournisseurs de tuiles, repliée par défaut
      // pour ne pas manger la carte sur mobile (C2).
      attributionControl: { compact: true },
      // MapLibre pose lui-même `role="region"` + `aria-label` sur son canvas :
      // on lui fournit **notre** étiquette plutôt que d'en empiler une seconde
      // sur le conteneur, ce qui créerait deux régions imbriquées (C7).
      locale: { ...MAPLIBRE_LOCALE_FR, 'Map.Title': initialViewRef.current.ariaLabel },
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    if (showGeolocateControl) {
      // RGPD (C8) : le contrôle ne déclenche la demande de permission qu'au clic
      // de l'utilisateur — jamais de géolocalisation silencieuse au chargement.
      map.addControl(
        new GeolocateControl({
          positionOptions: { enableHighAccuracy: false, timeout: 10_000 },
          showAccuracyCircle: true,
        }),
        'top-right',
      );
    }

    let hasLoaded = false;

    const handleLoad = () => {
      hasLoaded = true;
      setHasStyleError(false);
      onReadyRef.current?.(map);
    };

    // Dégradation gracieuse (C10) : fournisseur injoignable ou clé invalide →
    // message explicite plutôt qu'un rectangle vide et silencieux.
    //
    // Seules les erreurs survenues **avant** `load` sont fatales : une fois le
    // style chargé, MapLibre émet aussi `error` pour une tuile isolée en échec,
    // ce qui ne justifie pas de condamner toute la carte.
    const handleError = (event: MapLibreErrorEvent) => {
      console.error('[MapView] MapLibre error', event.error);
      if (!hasLoaded) {
        setHasStyleError(true);
      }
    };

    map.on('load', handleLoad);
    map.on('error', handleError);

    return () => {
      map.off('load', handleLoad);
      map.off('error', handleError);
      // `remove()` détruit le canvas WebGL, les workers et les écouteurs :
      // indispensable en StrictMode, où l'effet est monté deux fois en dev.
      map.remove();
      mapRef.current = null;
    };
    // `showGeolocateControl` est une option de configuration, fixée par l'écran
    // hôte : la basculer reconstruit la carte, ce qui est acceptable puisque
    // aucun écran ne la change en cours de vie.
  }, [showGeolocateControl]);

  // Recentrage sans reconstruction : le planificateur (F2) ajustera la caméra
  // à chaque nouvel itinéraire.
  //
  // Les dépendances sont les *coordonnées*, pas le tableau `center` : un appelant
  // qui écrit `center={[lng, lat]}` en ligne crée un nouveau tableau à chaque
  // rendu, ce qui relancerait l'animation en boucle.
  const [lng, lat] = center;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // C7 : pas d'animation imposée aux personnes sensibles au mouvement.
    map.easeTo({ center: [lng, lat], zoom, duration: prefersReducedMotion ? 0 : 600 });
  }, [lng, lat, zoom]);

  // Marqueur « ma position » (UF-202) — créé à la demande, détruit dès que la
  // position est effacée : rien ne subsiste sur la carte après une révocation (C8).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userPosition) return;

    // Élément sur mesure plutôt que la punaise par défaut : une pastille dit
    // « vous êtes ici », là où une punaise dit « ce lieu-ci » (styles : globals.css).
    const element = document.createElement('div');
    element.className = 'uf-user-marker';
    // Le marqueur porte l'information au lecteur d'écran (C7) ; la précision y
    // figure, car une position à ± 2 km ne se lit pas comme une position à ± 20 m.
    element.setAttribute('role', 'img');
    element.setAttribute(
      'aria-label',
      `Votre position approximative (${formatAccuracy(userPosition.accuracyMeters)})`,
    );

    const marker = new Marker({ element }).setLngLat(toLngLat(userPosition)).addTo(map);
    return () => {
      marker.remove();
    };
  }, [userPosition]);

  return (
    <div className={`relative overflow-hidden rounded-lg border border-ink-200 ${className}`}>
      <div ref={containerRef} className="h-full w-full bg-surface-muted" />

      {/* Alternative non visuelle (C7 — WCAG 1.1.1) : lue par les lecteurs d'écran, invisible à l'écran. */}
      <p className="sr-only">{textAlternative}</p>

      {hasStyleError && (
        <p
          role="status"
          className="absolute inset-x-3 bottom-3 rounded-md bg-white/95 p-3 text-sm text-ink-700 shadow-card"
        >
          Le fond de carte n&apos;a pas pu être chargé. Les itinéraires restent consultables dans la
          liste.
        </p>
      )}

      {/* Surcouches (légende, marqueurs custom) : la couche laisse passer les
          gestes vers la carte, chaque enfant réactive `pointer-events` s'il est cliquable. */}
      {children && <div className="pointer-events-none absolute inset-0">{children}</div>}
    </div>
  );
}
