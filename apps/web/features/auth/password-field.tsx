'use client';

import { useState } from 'react';

import { InputField } from '../../components/ui/input-field';
import type { InputFieldProps } from '../../components/ui/input-field';

export type PasswordFieldProps = Omit<InputFieldProps, 'type' | 'leadingIcon' | 'trailing'>;

/**
 * Champ mot de passe des écrans d'auth (F1) — reprend le champ de la maquette
 * Figma « 2. CONNEXION F1 » : cadenas à gauche, bascule « VOIR » à droite.
 *
 * La bascule est un vrai `<button>` (et non un texte cliquable) : elle est donc
 * atteignable au clavier, son libellé change avec l'état, et la zone tactile est
 * portée à 24 px de haut (C7 — WCAG 2.5.8 « taille de cible »). Le complément
 * `sr-only` donne un nom accessible complet aux lecteurs d'écran.
 *
 * Aucun état n'est remonté : la visibilité est purement locale à l'affichage,
 * le mot de passe n'est jamais copié ailleurs (C11).
 */
export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <InputField
      type={visible ? 'text' : 'password'}
      leadingIcon="🔒"
      trailing={
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="-my-1 -mr-1 shrink-0 rounded-sm px-1 py-1 text-[11px] font-bold tracking-wide text-action-dark uppercase hover:underline"
        >
          {visible ? 'Masquer' : 'Voir'}
          <span className="sr-only"> le mot de passe</span>
        </button>
      }
      {...props}
    />
  );
}
