import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

export interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Libellé toujours visible, associé au champ via `htmlFor` (C7). */
  label: string;
  /** Message d'erreur : bordure rouge + annonce aux lecteurs d'écran. */
  error?: string;
  /** Texte d'aide affiché sous le libellé. */
  hint?: string;
}

/**
 * Champ de saisie avec libellé et erreur — design system UrbanFlow (UF-007),
 * d'après la maquette Figma « Champs de saisie & tokens ».
 *
 * Accessibilité (C7) : label associé, erreur reliée par `aria-describedby`
 * et annoncée via `role="alert"`, `aria-invalid` en cas d'erreur, focus
 * matérialisé par la bordure bleue + halo (WCAG 2.4.7).
 */
export function InputField({
  label,
  error,
  hint,
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
    ? 'border-error focus:shadow-[0_0_0_3px_var(--color-tint-red)]'
    : 'border-ink-200 focus:border-action focus:shadow-[0_0_0_3px_var(--color-tint-blue)]';

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
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`rounded-md border-2 bg-white px-[15px] py-3 text-sm text-ink placeholder:text-placeholder focus:outline-none disabled:bg-surface-muted disabled:text-ink-500 ${stateClasses}`}
        {...inputProps}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-error">
          {error}
        </p>
      )}
    </div>
  );
}
