import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Libellé toujours visible, associé au champ via `htmlFor` (C7). */
  label: string;
  /** Message d'erreur : bordure rouge + annonce aux lecteurs d'écran. */
  error?: string;
  /** Texte d'aide affiché sous le libellé. */
  hint?: string;
  /** Pictogramme décoratif placé dans le champ, avant la saisie (maquette « Connexion (F1) »). */
  leadingIcon?: ReactNode;
  /** Contenu placé dans le champ, après la saisie — ex. le bouton « Voir » du mot de passe. */
  trailing?: ReactNode;
}

/**
 * Champ de saisie avec libellé et erreur — design system UrbanFlow (UF-007),
 * d'après la maquette Figma « Champs de saisie & tokens » et l'écran
 * « 2. CONNEXION F1 » (icône interne + action à droite).
 *
 * La bordure et le halo de focus sont portés par le conteneur (`focus-within`)
 * et non par l'`input` : c'est ce qui permet d'insérer une icône et une action
 * *à l'intérieur* du cadre, comme dans la maquette, sans casser l'état focus.
 *
 * Accessibilité (C7) : label associé, erreur reliée par `aria-describedby`
 * et annoncée via `role="alert"`, `aria-invalid` en cas d'erreur, focus
 * matérialisé par la bordure bleue + halo (WCAG 2.4.7).
 */
export function InputField({
  label,
  error,
  hint,
  leadingIcon,
  trailing,
  id,
  className = '',
  ...inputProps
}: InputFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const stateClasses = error
    ? 'border-error focus-within:shadow-[0_0_0_3px_var(--color-tint-red)]'
    : 'border-ink-200 focus-within:border-action focus-within:shadow-[0_0_0_3px_var(--color-tint-blue)]';

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className="text-xs font-bold text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      )}
      <div
        className={`flex items-center gap-2 rounded-md border-2 bg-white px-[15px] py-3 has-[input:disabled]:bg-surface-muted ${stateClasses}`}
      >
        {leadingIcon && (
          <span aria-hidden="true" className="shrink-0 text-sm/[21px] text-ink-500">
            {leadingIcon}
          </span>
        )}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-placeholder focus:outline-none disabled:text-ink-500"
          {...inputProps}
        />
        {trailing}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-error">
          {error}
        </p>
      )}
    </div>
  );
}
