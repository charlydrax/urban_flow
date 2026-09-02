import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'neutral' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Variante visuelle de la charte Figma (défaut : `primary`). */
  variant?: ButtonVariant;
  /** Taille (padding + corps de texte) de la charte Figma (défaut : `md`). */
  size?: ButtonSize;
}

const baseClasses =
  'inline-flex items-center justify-center gap-2 rounded-md font-bold transition-colors ' +
  'disabled:pointer-events-none disabled:border-transparent disabled:bg-ink-200 disabled:text-ink-500';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark',
  secondary: 'bg-action text-white hover:bg-action-dark',
  outline: 'border-2 border-primary bg-white text-primary-dark hover:bg-tint-green',
  // Bouton secondaire neutre : refus d'une invite, action de repli d'une confirmation.
  neutral: 'border-2 border-ink-200 bg-white text-ink hover:bg-surface-muted',
  ghost: 'text-action-dark hover:bg-tint-blue',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-2 text-[13px]',
  md: 'px-5 py-[11px] text-sm',
  lg: 'px-[26px] py-3.5 text-base',
};

/**
 * Bouton du design system UrbanFlow (UF-007) — variantes et tailles issues
 * de la maquette Figma « Boutons — variants × tailles ».
 *
 * Accessibilité (C7) : focus clavier visible via l'outline global
 * (globals.css), état désactivé contrasté (fond Ink 200 / texte Ink 500),
 * `type="button"` par défaut pour éviter les soumissions involontaires.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    />
  );
}
