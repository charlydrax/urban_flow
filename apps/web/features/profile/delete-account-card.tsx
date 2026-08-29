'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { ApiError, apiClient } from '../../lib/api-client';
import { useSession } from '../auth/session-provider';

/** Mot à saisir pour armer la suppression — en français, comme toute l'UI. */
export const DELETE_CONFIRMATION_WORD = 'SUPPRIMER';

/**
 * Vérifie la saisie de confirmation.
 *
 * Tolère la casse et les espaces autour : l'objectif est de **ralentir** un
 * geste irréversible, pas de piéger l'utilisateur sur une majuscule. Exporté
 * pour être testé sans monter le composant.
 */
export function isDeletionConfirmed(input: string): boolean {
  return input.trim().toUpperCase() === DELETE_CONFIRMATION_WORD;
}

/**
 * Message d'échec — volontairement sans détail technique, et sans dire que le
 * compte « existe peut-être encore » : l'utilisateur n'a pas à interpréter, il a
 * besoin de savoir si son compte est parti ou non. Ici, il ne l'est pas.
 */
const DELETE_ERROR =
  'La suppression n’a pas pu aboutir. Votre compte et vos données sont intacts — réessayez dans un instant.';

/**
 * Zone de suppression de compte du profil (UF-603 — droit à l'effacement,
 * art. 17 RGPD, C8 ; recette 3 du ticket).
 *
 * ## Pourquoi une confirmation par saisie, et pas un `window.confirm`
 *
 * La boîte native n'est ni stylable, ni traduisible, ni annonçable correctement
 * par un lecteur d'écran, et elle se ferme d'un `Entrée` réflexe. Comme
 * l'opération est **irréversible et silencieuse** — rien ne prévient par mail,
 * rien ne se restaure — le garde-fou doit demander un geste qu'on ne fait pas
 * par accident : recopier un mot. C'est aussi ce qui donne le temps de lire la
 * liste de ce qui va disparaître.
 *
 * ## Ce que l'écran promet, et ce qu'il tient
 *
 * L'API renvoie le **décompte** de ce qu'elle a effacé ; il est affiché avant la
 * redirection. Un droit exercé sans preuve d'exécution n'en est pas vraiment un,
 * et cela rend la recette vérifiable sans ouvrir la base.
 *
 * Accessibilité (C7) : le panneau de confirmation reçoit le focus à son
 * ouverture (WCAG 4.1.3), le champ porte un `label` visible et une description
 * liée, le bouton reste désactivé tant que la saisie ne correspond pas, et
 * l'échec est annoncé en `role="alert"`. Le rouge n'est jamais le seul signal :
 * le texte dit lui-même ce qui va être supprimé.
 */
export function DeleteAccountCard() {
  const { forgetSession } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [input, setInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);

  // Le panneau apparaît sous le bouton : sans déplacement du focus, un
  // utilisateur au clavier ne saurait pas qu'il vient de s'ouvrir (C7).
  useEffect(() => {
    if (confirming) panelRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    setInput('');
    setError(null);
  };

  const handleDelete = async () => {
    if (!isDeletionConfirmed(input)) return;

    setDeleting(true);
    setError(null);
    try {
      const result = await apiClient.deleteAccount();

      // Le compte n'existe plus : l'écran doit dire ce qui est parti avant de
      // rendre la main, pas disparaître dans une redirection muette.
      const trips = result.deletedSearchHistoryCount;
      setDone(
        trips > 0
          ? `Compte supprimé, ainsi que ${trips} trajet${trips > 1 ? 's' : ''} de votre historique.`
          : 'Compte supprimé. Aucun trajet n’était enregistré.',
      );

      // Court délai : le temps de lire la confirmation. La session est déjà
      // morte côté serveur (cookie purgé par l'API), donc rien n'est accessible
      // pendant ce laps de temps.
      window.setTimeout(() => forgetSession('account-deleted'), 1500);
    } catch (caught) {
      // Un 404 signifie que le compte avait déjà disparu : le résultat voulu est
      // atteint, on termine comme un succès plutôt que d'inquiéter pour rien.
      if (caught instanceof ApiError && caught.status === 404) {
        forgetSession('account-deleted');
        return;
      }
      setError(DELETE_ERROR);
      setDeleting(false);
    }
  };

  if (done) {
    return (
      <Card className="border-2 border-primary bg-tint-green">
        <p role="status" className="text-sm font-bold text-primary-dark">
          {done}
        </p>
        <p className="mt-1 text-xs text-ink-700">Redirection vers l’écran de connexion…</p>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-error">
      <CardTitle as="h2" className="mb-2 text-error">
        Supprimer mon compte
      </CardTitle>

      <p className="mb-3 max-w-prose text-sm text-ink-700">
        Cette action efface définitivement votre compte, vos préférences de mobilité et{' '}
        <strong>l’intégralité de votre historique de trajets</strong>. Elle est immédiate et
        irréversible&nbsp;: rien n’est conservé, pas même une copie anonymisée.
      </p>
      <p className="mb-4 text-xs text-ink-700">
        Vous cherchez seulement à retirer votre accord à la géolocalisation&nbsp;? L’interrupteur
        ci-dessus suffit, votre compte reste intact.{' '}
        <Link href="/confidentialite" className="underline underline-offset-4">
          En savoir plus sur vos données
        </Link>
      </p>

      {!confirming ? (
        <Button
          variant="neutral"
          onClick={() => setConfirming(true)}
          className="min-h-11 border-error text-error hover:bg-tint-red"
        >
          Supprimer mon compte et mes données
        </Button>
      ) : (
        <div
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="delete-account-confirm-title"
          className="flex flex-col gap-3 rounded-md bg-tint-red p-4"
        >
          <p id="delete-account-confirm-title" className="text-sm font-bold text-ink">
            Confirmer la suppression
          </p>

          <div className="flex flex-col gap-1">
            <label htmlFor="delete-account-confirm" className="text-xs font-bold text-ink">
              Saisissez <span className="font-mono">{DELETE_CONFIRMATION_WORD}</span> pour confirmer
            </label>
            <input
              id="delete-account-confirm"
              name="deleteConfirmation"
              type="text"
              value={input}
              autoComplete="off"
              disabled={deleting}
              aria-describedby="delete-account-confirm-help"
              onChange={(event) => setInput(event.target.value)}
              className="min-h-11 rounded-md border-2 border-ink-200 bg-white px-3 py-2 text-sm"
            />
            <p id="delete-account-confirm-help" className="text-xs text-ink-700">
              Le bouton de suppression ne s’active qu’une fois le mot saisi.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-xs font-semibold text-error">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="neutral"
              size="sm"
              onClick={() => void handleDelete()}
              disabled={deleting || !isDeletionConfirmed(input)}
              aria-busy={deleting}
              className="min-h-11 border-error text-error hover:bg-white"
            >
              {deleting ? 'Suppression…' : 'Supprimer définitivement'}
            </Button>
            <Button
              variant="neutral"
              size="sm"
              onClick={cancel}
              disabled={deleting}
              className="min-h-11"
            >
              Annuler
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
