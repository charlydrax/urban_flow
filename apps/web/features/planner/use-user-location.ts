'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiClient } from '../../lib/api-client';
import {
  formatAccuracy,
  GEOLOCATION_ERROR_MESSAGES,
  getCurrentPosition,
  type UserPosition,
} from '../../lib/geolocation';
import {
  forgetGuestGeolocationConsent,
  readGuestGeolocationConsent,
  rememberGuestGeolocationConsent,
} from '../../lib/geolocation-consent';

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

/**
 * Où l'accord de géolocalisation est consigné — ce que le panneau de
 * consentement doit annoncer **avant** que la personne ne décide (C8).
 *
 * - `account` — connecté : horodaté côté serveur, révocable depuis le profil
 * - `device` — invité : mémorisé dans ce navigateur, révocable ici même
 */
export type ConsentScope = 'account' | 'device';

export interface UserLocationState {
  status: UserLocationStatus;
  /** Dernière position connue, ou `null` (repli : centre par défaut, Lyon). */
  position: UserPosition | null;
  /** Message à annoncer — information en `role="status"`, échec en `role="alert"`. */
  message: string | null;
  /** Vrai pendant un travail asynchrone : sert à désactiver le bouton. */
  busy: boolean;
  /** Portée de l'accord demandé, à afficher dans le panneau de consentement. */
  consentScope: ConsentScope;
  /** Clic sur « Me localiser » : vérifie le consentement puis localise. */
  requestLocation: () => void;
  /** Consentement accordé dans le panneau : trace l'accord, puis localise. */
  grantConsent: () => void;
  /** Consentement refusé : aucune donnée collectée, retour à la saisie manuelle. */
  declineConsent: () => void;
  /** Oublie la position affichée (minimisation C8) — et, pour un invité, son accord. */
  forgetPosition: () => void;
}

/** Échec de lecture/écriture du consentement : on ne collecte rien sans trace. */
const CONSENT_API_ERROR =
  'Impossible de vérifier votre consentement à la géolocalisation pour le moment. Saisissez votre point de départ à la main.';

/** Refus explicite dans le panneau : dégradation propre, message rassurant (C7). */
const CONSENT_DECLINED =
  'Géolocalisation refusée. Rien n’a été enregistré : saisissez votre point de départ à la main.';

/** Effacement de la position — le message dit exactement ce qui a été oublié (C8). */
const POSITION_FORGOTTEN = 'Votre position a été effacée de cet écran.';
const POSITION_AND_CONSENT_FORGOTTEN =
  'Votre position a été effacée, et votre accord n’est plus mémorisé sur cet appareil.';

/**
 * Pilote la géolocalisation consentie du planificateur (F2 — UF-202/UF-802, C6/C8).
 *
 * **Rien ne part avant un geste de l'utilisateur** : la permission du navigateur
 * n'est jamais demandée au chargement de la page, mais au clic sur « Me
 * localiser » — et, la première fois, seulement après un consentement explicite.
 *
 * ## Deux parcours selon qu'il y a un compte ou non (UF-802)
 *
 * |                                 | Connecté                              | Invité                        |
 * | ------------------------------- | ------------------------------------- | ----------------------------- |
 * | Lecture de l'accord             | `GET /users/me`                       | `localStorage` de l'appareil  |
 * | Écriture de l'accord            | `PATCH /users/me` (horodatage serveur) | `localStorage`               |
 * | Appels réseau pour se localiser | 1 à 2                                 | **aucun**                     |
 * | Révocation                      | écran de profil (UF-107)              | « Effacer ma position », ici  |
 *
 * Le parcours invité ne touche **aucun endpoint** : c'est la correction du
 * défaut relevé par UF-802 — `getProfile()` en tête de parcours répondait `401`
 * pour un visiteur, et « Me localiser » échouait donc systématiquement sur
 * l'écran qu'UF-801 venait pourtant d'ouvrir à tous. La géolocalisation est une
 * capacité du navigateur : elle n'a jamais eu besoin d'un profil pour
 * fonctionner, seulement d'un accord.
 *
 * **Traçabilité RGPD (C8)** : pour un compte, l'accord est enregistré côté API
 * (`geolocationConsentAt` horodaté en base) — il est donc opposable, auditable
 * et révocable depuis l'écran de profil. Corollaire assumé : si l'API est
 * injoignable, on **ne géolocalise pas** un utilisateur connecté, faute de
 * pouvoir tracer son consentement. Pour un invité, il n'y a rien à opposer à
 * qui que ce soit : aucune donnée n'est conservée côté serveur, et l'accord
 * reste sur l'appareil (voir `lib/geolocation-consent.ts`).
 *
 * **Consentement déjà donné** : on saute le panneau et on va droit à la demande
 * du navigateur — le consentement RGPD se recueille une fois, pas à chaque clic.
 * La permission navigateur, elle, reste un second verrou indépendant.
 *
 * Éco-conception (C5) : le profil n'est lu qu'au premier clic (jamais au
 * chargement), puis mémorisé pour la durée de la page ; aucun `watchPosition`,
 * donc aucun suivi continu de l'utilisateur.
 *
 * @param isGuest Vrai quand aucune session n'est ouverte (voir `useSession`)
 */
export function useUserLocation(isGuest: boolean): UserLocationState {
  const [status, setStatus] = useState<UserLocationStatus>('idle');
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Consentement enregistré : `null` tant qu'on ne l'a pas lu. En ref plutôt
  // qu'en state — sa valeur ne change rien à l'affichage, seulement au parcours.
  const consentRef = useRef<boolean | null>(null);

  // Connexion ou déconnexion en cours de page : l'accord mémorisé n'est plus
  // celui de la bonne personne. On l'oublie, pour le relire à sa source.
  useEffect(() => {
    consentRef.current = null;
  }, [isGuest]);

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

      // Invité : l'accord se lit sur l'appareil, sans réseau et sans attente —
      // donc sans passer par `checking-consent`, qui n'annoncerait rien.
      if (isGuest) {
        consentRef.current = readGuestGeolocationConsent();
        if (consentRef.current) {
          await locate();
          return;
        }
        setMessage(null);
        setStatus('consent-required');
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
  }, [isGuest, locate]);

  const grantConsent = useCallback(() => {
    void (async () => {
      // Invité : l'accord reste sur l'appareil. Rien à envoyer, rien à attendre.
      if (isGuest) {
        rememberGuestGeolocationConsent();
        consentRef.current = true;
        await locate();
        return;
      }

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
  }, [isGuest, locate]);

  const declineConsent = useCallback(() => {
    // Aucun appel réseau : un refus ne s'enregistre pas, il ne se passe rien.
    setStatus('idle');
    setMessage(CONSENT_DECLINED);
  }, []);

  const forgetPosition = useCallback(() => {
    setPosition(null);
    setStatus('idle');
    // Pour un invité, ce bouton est le SEUL chemin de retrait de l'accord : il
    // n'a pas d'écran de profil où le révoquer (RGPD art. 7-3 — voir
    // `lib/geolocation-consent.ts`). Pour un compte, l'accord est une donnée de
    // profil : l'effacer ici serait une révocation cachée derrière un bouton
    // qui n'annonce que l'effacement de la position.
    if (isGuest) {
      forgetGuestGeolocationConsent();
      consentRef.current = null;
    }
    setMessage(isGuest ? POSITION_AND_CONSENT_FORGOTTEN : POSITION_FORGOTTEN);
  }, [isGuest]);

  return {
    status,
    position,
    message,
    busy: status === 'checking-consent' || status === 'locating',
    consentScope: isGuest ? 'device' : 'account',
    requestLocation,
    grantConsent,
    declineConsent,
    forgetPosition,
  };
}
