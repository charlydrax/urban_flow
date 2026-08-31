'use client';

import Link from 'next/link';

export interface EcoModeBannerProps {
  /** `true` quand le serveur classe (ou classera) par empreinte croissante. */
  active: boolean;
  /** `true` pour un visiteur sans compte — il n'a pas de profil à régler. */
  isGuest: boolean;
}

/**
 * Bandeau « mode éco » du planificateur (UF-804) — la bande verte de la planche
 * Figma (« 4. PLANIFICATEUR F2 » : « 🌱 Mode éco activé — les itinéraires bas
 * carbone seront proposés en premier »).
 *
 * ## Une affirmation, donc une affirmation vérifiable
 *
 * Le bandeau ne décore pas : il **annonce ce que le serveur va faire**. Il
 * s'allume exactement quand `sortedBy` vaut `carbonAsc`, c'est-à-dire quand la
 * priorité du profil est « écolo » — le défaut du produit, donc l'état du
 * visiteur comme du nouvel inscrit (voir `isEcoModeActive`).
 *
 * Un compte qui a choisi la priorité « rapide » dans son profil de mobilité
 * (F1) voit donc l'autre version du bandeau, qui dit la vérité et donne le lien
 * pour changer d'avis. Peindre le message vert dans tous les cas aurait fait
 * lire « bas carbone en premier » au-dessus d'une liste classée par durée : le
 * genre de détail qui, une fois repéré, décrédibilise tout le reste de l'écran.
 *
 * ## Pourquoi il n'est pas cliquable lui-même
 *
 * Le mode éco **n'est pas un interrupteur de cet écran** : c'est la priorité du
 * profil, qui vaut pour toutes les recherches et se règle dans « Mon profil ».
 * En faire une bascule locale créerait deux réglages pour une même chose, et la
 * question insoluble de savoir lequel gagne. Le bandeau renvoie donc vers le
 * seul endroit où le réglage vit — et, pour un visiteur, vers la connexion,
 * puisqu'il n'a pas de profil à régler.
 *
 * Accessibilité (C7) : `role="status"` et non `alert` — c'est un état, pas un
 * incident, et couper la parole au lecteur d'écran pour l'annoncer serait
 * disproportionné (WCAG 4.1.3). Le pictogramme est décoratif et doublé du
 * texte. Le vert 700 sur vert 50 donne 6.9:1, au-delà du seuil AA.
 */
export function EcoModeBanner({ active, isGuest }: EcoModeBannerProps) {
  if (active) {
    return (
      <p
        role="status"
        className="rounded-lg border border-primary/25 bg-tint-green px-3 py-2.5 text-xs text-primary-dark"
      >
        <span aria-hidden="true">🌱 </span>
        <strong className="font-bold">Mode éco activé</strong> — les itinéraires bas carbone sont
        proposés en premier.
      </p>
    );
  }

  return (
    <p
      role="status"
      className="rounded-lg border border-ink-200 bg-surface-muted px-3 py-2.5 text-xs text-ink-700"
    >
      <span aria-hidden="true">⚡ </span>
      <strong className="font-bold">Mode rapide</strong> — les itinéraires les plus courts sont
      proposés en premier.{' '}
      {isGuest ? (
        <Link href="/login" className="font-semibold text-action-dark underline underline-offset-2">
          Connectez-vous
        </Link>
      ) : (
        <Link
          href="/profil"
          className="font-semibold text-action-dark underline underline-offset-2"
        >
          Changez de priorité dans votre profil
        </Link>
      )}{' '}
      pour passer en mode éco.
    </p>
  );
}
