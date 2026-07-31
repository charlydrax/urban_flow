'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiClient } from '../../lib/api-client';
import {
  formatAccuracy,
  GEOLOCATION_ERROR_MESSAGES,
  getCurrentPosition,
  type UserPosition,
} from '../../lib/geolocation';

/**
 * État du parcours « Me localiser » (UF-202).
 *
 * - `idle` — rien de demandé (état initial, et retour après un refus)
 * - `checking-consent` — on relit le consentement enregistré côté API
 * - `consent-required` — le panneau de consentement RGPD est affiché
 * - `locating` — le navigateur cherche la position
 * - `located` — position obtenue
 * - `error` — échec, message explicite affiché ; l'app reste utilisable
 */
export type UserLocationStatus =
  | 'idle'
  | 'checking-consent'
  | 'locating'
  | 'consent-required'
  | 'located'
  | 'error';

export interface UserLocationState {
  status: UserLocationStatus;
  /** Dernière position connue, ou `null` (repli : centre par défaut, Lyon). */
  position: UserPosition | null;
  /** Message à annoncer — information en `role="status"`, échec en `role="alert"`. */
  message: string | null;
  /** Vrai pendant un travail asynchrone : sert à désactiver le bouton. */
  busy: boolean;
  /** Clic sur « Me localiser » : vérifie le consentement puis localise. */
  requestLocation: () => void;
  /** Consentement accordé dans le panneau : trace côté API, puis localise. */
  grantConsent: () => void;
  /** Consentement refusé : aucune donnée collectée, retour à la saisie manuelle. */
  declineConsent: () => void;
  /** Oublie la position affichée (minimisation C8) sans toucher au consentement. */
  forgetPosition: () => void;
}

/** Échec de lecture/écriture du consentement : on ne collecte rien sans trace. */
const CONSENT_API_ERROR =
  'Impossible de vérifier votre consentement à la géolocalisation pour le moment. Saisissez votre point de départ à la main.';

/** Refus explicite dans le panneau : dégradation propre, message rassurant (C7). */
const CONSENT_DECLINED =
  'Géolocalisation refusée. Rien n’a été enregistré : saisissez votre point de départ à la main.';

/**
 * Pilote la géolocalisation consentie du planificateur (F2 — UF-202, C6/C8).
 *
 * **Rien ne part avant un geste de l'utilisateur** : la permission du navigateur
 * n'est jamais demandée au chargement de la page, mais au clic sur « Me
 * localiser » — et, la première fois, seulement après un consentement explicite.
 *
 * **Traçabilité RGPD (C8)** : le consentement est enregistré côté API
 * (`PATCH /users/me`, champ `geolocationConsentAt` horodaté en base), pas dans
 * le navigateur — il est donc opposable, auditable, et révocable depuis l'écran
 * de profil (UF-107). Corollaire assumé : si l'API est injoignable, on **ne
 * géolocalise pas**, faute de pouvoir tracer le consentement.
 *
 * **Consentement déjà donné** : on saute le panneau et on va droit à la demande
 * du navigateur — le consentement RGPD se recueille une fois, pas à chaque clic.
 * La permission navigateur, elle, reste un second verrou indépendant.
 *
 * Éco-conception (C5) : le profil n'est lu qu'au premier clic (jamais au
 * chargement), puis mémorisé pour la durée de la page ; aucun `watchPosition`,
 * donc aucun suivi continu de l'utilisateur.
 */
export function useUserLocation(): UserLocationState {
  const [status, setStatus] = useState<UserLocationStatus>('idle');
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Consentement enregistré : `null` tant qu'on ne l'a pas lu. En ref plutôt
  // qu'en state — sa valeur ne change rien à l'affichage, seulement au parcours.
  const consentRef = useRef<boolean | null>(null);

  // Les réponses asynchrones peuvent arriver après une navigation : on ne
  // repousse alors plus d'état dans un composant démonté.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Demande la position au navigateur et traduit chaque issue en état affichable. */
  const locate = useCallback(async () => {
    setStatus('locating');
    setMessage(null);

    const result = await getCurrentPosition();
    if (!mountedRef.current) return;

    if (!result.ok) {
      // Refus, timeout, GPS muet : trois messages distincts, aucun blocage (C6).
      setStatus('error');
      setMessage(GEOLOCATION_ERROR_MESSAGES[result.reason]);
      return;
    }

    const { ok: _ok, ...found } = result;
    setPosition(found);
    setStatus('located');
    setMessage(`Position trouvée à ${formatAccuracy(found.accuracyMeters)} près.`);
  }, []);

  const requestLocation = useCallback(() => {
    void (async () => {
      if (consentRef.current === true) {
        await locate();
        return;
      }

      setStatus('checking-consent');
      setMessage(null);
      try {
        const profile = await apiClient.getProfile();
        consentRef.current = profile.geolocationConsentAt !== null;
      } catch (error) {
        if (!mountedRef.current) return;
        // Un 401 est déjà traité par l'intercepteur global (purge + /login) :
        // afficher un message qui disparaîtra avec la redirection n'aide pas.
        if (error instanceof ApiError && error.status === 401) return;
        setStatus('error');
        setMessage(CONSENT_API_ERROR);
        return;
      }

      if (!mountedRef.current) return;
      if (consentRef.current) {
        await locate();
        return;
      }
      // Première demande : on explique avant de demander (C8 — consentement éclairé).
      setStatus('consent-required');
    })();
  }, [locate]);

  const grantConsent = useCallback(() => {
    void (async () => {
      setStatus('checking-consent');
      try {
        // L'horodatage du consentement est posé par le serveur : c'est lui qui
        // fait foi, pas l'horloge du poste client (C8/C11).
        await apiClient.updateProfile({ geolocationConsent: true });
        consentRef.current = true;
      } catch (error) {
        if (!mountedRef.current) return;
        if (error instanceof ApiError && error.status === 401) return;
        setStatus('error');
        setMessage(CONSENT_API_ERROR);
        return;
      }

      if (!mountedRef.current) return;
      await locate();
    })();
  }, [locate]);

  const declineConsent = useCallback(() => {
    // Aucun appel réseau : un refus ne s'enregistre pas, il ne se passe rien.
    setStatus('idle');
    setMessage(CONSENT_DECLINED);
  }, []);

  const forgetPosition = useCallback(() => {
    setPosition(null);
    setStatus('idle');
    setMessage('Votre position a été effacée de cet écran.');
  }, []);

  return {
    status,
    position,
    message,
    busy: status === 'checking-consent' || status === 'locating',
    requestLocation,
    grantConsent,
    declineConsent,
    forgetPosition,
  };
}
