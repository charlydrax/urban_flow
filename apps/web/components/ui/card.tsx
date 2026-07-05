import type { HTMLAttributes } from 'react';

/**
 * Carte du design system UrbanFlow (UF-007) — fond blanc, bordure Ink 200,
 * rayon 14 px et ombre légère, conformes à la maquette Figma (`div.ds-card`).
 */
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-ink-200 bg-white p-5 shadow-card ${className}`}
      {...props}
    />
  );
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Niveau de titre selon la hiérarchie de la page hôte (C7 — défaut : `h3`). */
  as?: 'h2' | 'h3' | 'h4';
}

/** Titre de carte — 15 px gras Ink 900, comme les `h3` des cartes Figma. */
export function CardTitle({ as: Heading = 'h3', className = '', ...props }: CardTitleProps) {
  return <Heading className={`text-[15px] font-bold text-ink ${className}`} {...props} />;
}
