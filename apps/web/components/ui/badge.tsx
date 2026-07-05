import type { HTMLAttributes } from 'react';

export type BadgeTone =
  | 'neutral'
  | 'success'
  | 'info'
  | 'reward'
  | 'alert'
  | 'bike'
  | 'scooter'
  | 'bus'
  | 'metro'
  | 'tram';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-tint-neutral text-ink-700',
  success: 'bg-tint-green text-primary-dark',
  info: 'bg-tint-blue text-action-dark',
  reward: 'bg-tint-gold text-gold',
  alert: 'bg-tint-red text-error',
  bike: 'bg-tint-green text-primary-dark',
  scooter: 'bg-tint-orange text-mode-scooter',
  bus: 'bg-tint-blue text-action-dark',
  metro: 'bg-tint-violet text-mode-metro',
  tram: 'bg-tint-teal text-mode-tram',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Ton sémantique ou mode de transport, d'après « Badges — états & modes ». */
  tone?: BadgeTone;
}

/**
 * Badge du design system UrbanFlow (UF-007) — pastille arrondie utilisée pour
 * les états système (acquis, en cours, perturbation…) et les modes de
 * transport des itinéraires (F2/F3).
 *
 * C7 : chaque ton associe un fond teinté clair à un texte ≥ 4.5:1 de
 * contraste (couleurs « texte » de la charte, jamais les couleurs vives).
 */
export function Badge({ tone = 'neutral', className = '', ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-[11px] py-1 text-xs font-semibold ${toneClasses[tone]} ${className}`}
      {...props}
    />
  );
}
