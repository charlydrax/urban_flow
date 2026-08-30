'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { Button } from '../../components/ui/button';
import { formatAccuracy, formatCoordinates } from '../../lib/geolocation';
import type { ConsentScope, UserLocationState } from './use-user-location';

/**
 * Troisième question du consentement éclairé — « et ensuite ? » — répondue
 * selon l'endroit où l'accord est réellement consigné (UF-802 — C8).
 *
 * Servir la phrase « révocable depuis votre profil » à un visiteur sans compte
 * serait faux sur les deux points : rien n'est enregistré côté serveur, et il
 * n'a pas de profil où aller. Un consentement n'est éclairé que s'il décrit ce
 * qui se passe vraiment.
 */
const CONSENT_RECORD_NOTICE: Record<ConsentScope, string> = {
  account:
    'Votre accord est enregistré avec sa date et reste révocable à tout moment depuis votre profil.',
  device:
    'Vous n’êtes pas connecté : votre position sert au calcul en cours et n’est enregistrée nulle part. Votre accord est mémorisé sur cet appareil seulement, et le bouton « Effacer ma position » l’oublie.',
};

/**
 * Panneau de consentement RGPD (C8), affiché **avant** toute demande de position.
 *
 * Contextuel plutôt que modal : il apparaît à l'endroit exact où la demande est
 * née, sans piéger le focus ni masquer le formulaire. Le focus lui est tout de
 * même déplacé, sinon un utilisateur au clavier ou au lecteur d'écran ne saurait
 * pas qu'un contenu vient d'apparaître (C7 — WCAG 4.1.3).
 *
 * Le contenu répond aux trois questions du consentement éclairé : quelle donnée,
 * pour quoi faire, et comment revenir en arrière — cette dernière dépendant de
 * `scope`, car un invité et un titulaire de compte ne révoquent pas au même
 * endroit (voir `CONSENT_RECORD_NOTICE`).
 */
function ConsentPanel({
  onGrant,
  onDecline,
  busy,
  scope,
}: {
  onGrant: () => void;
  onDecline: () => void;
  busy: boolean;
  scope: ConsentScope;
}) {
  const headingRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div
      role="group"
      aria-labelledby="geoloc-consent-title"
      className="flex flex-col gap-3 rounded-md border-2 border-action bg-tint-blue p-4"
    >
      <p
        id="geoloc-consent-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-sm font-bold text-ink"
      >
        <span aria-hidden="true">📍 </span>
        Utiliser votre position&nbsp;?
      </p>
      <p className="text-xs text-ink-700">
        UrbanFlow lira les coordonnées fournies par votre navigateur pour pré-remplir votre point de
        départ et recentrer la carte. Elles ne servent qu’au calcul de vos itinéraires.{' '}
        {CONSENT_RECORD_NOTICE[scope]}
      </p>
      {/* UF-603 : « éclairé » suppose que le détail soit atteignable au moment
          du choix, pas seulement quelque part dans le pied de page (C8). */}
      <p className="text-xs">
        <Link href="/confidentialite" className="underline underline-offset-4 text-action-dark">
          Lire la politique de confidentialité
        </Link>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onGrant} disabled={busy}>
          Autoriser la géolocalisation
        </Button>
        <Button variant="neutral" size="sm" onClick={onDecline} disabled={busy}>
          Non merci
        </Button>
      </div>
    </div>
  );
}

/**
 * Bloc « Me localiser » du planificateur (F2 — UF-202).
 *
 * Regroupe le déclencheur explicite, le panneau de consentement et le compte
 * rendu de l'opération. Toute la logique vit dans `useUserLocation` : ce
 * composant ne fait qu'afficher l'état courant.
 *
 * Accessibilité (C7) : le bouton annonce son travail en cours via
 * `aria-busy`, les issues sont annoncées en `role="status"` (succès, attente) ou
 * `role="alert"` (échec), et la position obtenue est donnée en toutes lettres —
 * elle n'est jamais visible uniquement sur la carte.
 */
export function LocateMe({ location }: { location: UserLocationState }) {
  const { status, position, message, busy, consentScope } = location;

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        onClick={location.requestLocation}
        disabled={busy}
        aria-busy={busy}
        className="justify-center"
      >
        <span aria-hidden="true">📍</span>
        {busy ? 'Recherche de votre position…' : 'Me localiser'}
      </Button>

      {status === 'consent-required' && (
        <ConsentPanel
          onGrant={location.grantConsent}
          onDecline={location.declineConsent}
          busy={busy}
          scope={consentScope}
        />
      )}

      {message && (
        <p
          role={status === 'error' ? 'alert' : 'status'}
          className={`text-xs ${status === 'error' ? 'font-semibold text-error' : 'text-ink-700'}`}
        >
          {message}
        </p>
      )}

      {position && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
          <span>
            Coordonnées&nbsp;: {formatCoordinates(position)} (
            {formatAccuracy(position.accuracyMeters)})
          </span>
          {/* Minimisation (C8) : l'utilisateur peut retirer sa position de l'écran
              sans avoir à révoquer son consentement dans le profil. */}
          <Button variant="ghost" size="sm" onClick={location.forgetPosition} className="px-2 py-1">
            Effacer ma position
          </Button>
        </p>
      )}
    </div>
  );
}
