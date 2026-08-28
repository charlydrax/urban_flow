'use client';

import type { Itinerary } from '@urbanflow/shared';

import { formatCarbon } from '../../lib/format-carbon';
import { describeItinerary, itineraryClock, modeSequence } from '../../lib/itinerary-cards';

export interface ItineraryCardProps {
  itinerary: Itinerary;
  /** Rang dans la liste, à partir de 1 — annoncé aux lecteurs d'écran. */
  position: number;
  total: number;
  selected: boolean;
  /**
   * Raison de la mise en tête (« le plus rapide », « empreinte la plus
   * faible »), affichée sur la première carte seulement — `null` ailleurs.
   */
  bestReason: string | null;
  onSelect: () => void;
}

/**
 * Carte de résultat du panneau d'itinéraires (UF-404), d'après la maquette
 * « 5. RÉSULTATS F2+F3 ».
 *
 * ## Ce qu'elle montre, et dans quel ordre
 *
 * ```
 * ┌──────────────────────────────────────────────┐
 * │ ● [Meilleur choix · le plus rapide]   22 min │  ← la durée d'abord : c'est
 * │                                              │    ce qu'on compare
 * │ 🚶 3 › 🚲 11 › 🚌 C3 6 › 🚶 2                │  ← la séquence de modes
 * │                                              │
 * │ 🌱 240 g CO₂   ♿ Accessible   09:41 → 10:03 │  ← les infos secondaires
 * └──────────────────────────────────────────────┘
 * ```
 *
 * La durée est en gras, en `font-display` et à droite, comme sur la maquette :
 * c'est le critère que l'œil balaye verticalement d'une carte à l'autre. Chaque
 * étape porte **la couleur du tracé de son mode** (`MODE_TRACK_STYLES`) : c'est
 * ce qui fait qu'on reconnaît, dans le trait bleu tireté dessiné à droite, le
 * « 🚌 » lu à gauche. Cette couleur est posée sur une pastille et non sur le
 * texte — les couleurs de modes sont validées au seuil des objets graphiques
 * (3:1), pas à celui du texte courant (4.5:1).
 *
 * ## Écarts assumés à la maquette
 *
 * La maquette porte trois éléments que ce ticket ne peut pas honnêtement
 * rendre, et qui sont donc **absents** plutôt qu'inventés :
 *
 * | Élément maquette      | Pourquoi il n'est pas là                              |
 * | --------------------- | ----------------------------------------------------- |
 * | « ★ Recommandé IA »   | Aucun modèle ne classe les options : c'est le tri du   |
 * |                       | profil (F1). Le badge dit donc la vraie raison.        |
 * | « · 1,90 € »          | Aucune source ne publie de tarif à ce stade (F3).      |
 * | « ⭐ +45 pts »        | La gamification est hors périmètre du prototype.       |
 *
 * Le **badge CO₂**, lui, que le ticket demandait seulement de « réserver
 * visuellement », est rempli : la donnée existe depuis UF-401, et une pastille
 * vide n'aurait rien appris à personne. Sa place dans la mise en page est celle
 * que la maquette lui donne, donc le remplir plus tard n'aurait rien déplacé.
 *
 * ## Toute la carte est cliquable
 *
 * Le bouton radio n'est pas seul à recevoir le clic : la carte entière est un
 * `<label>`, ce qui donne une cible de la taille du bloc plutôt qu'un disque de
 * 16 px (WCAG 2.5.5). L'état retenu se voit à la **bordure épaissie** et au fond
 * teinté autant qu'à la couleur, et le radio coché le dit aux technologies
 * d'assistance (WCAG 1.4.1 / 4.1.2).
 *
 * Couvre : C2 (mobile-first), C7 (WCAG 1.1.1, 1.4.1, 2.5.5, 4.1.2), C12 (mention
 * PMR reprise de `Itinerary.accessible`).
 */
export function ItineraryCard({
  itinerary,
  position,
  total,
  selected,
  bestReason,
  onSelect,
}: ItineraryCardProps) {
  const legs = modeSequence(itinerary);
  const clock = itineraryClock(itinerary);

  return (
    <label
      className={`flex cursor-pointer flex-col gap-2 rounded-lg p-3 transition-colors ${
        selected
          ? 'border-2 border-primary bg-tint-green'
          : 'border border-ink-200 bg-white shadow-card hover:border-ink-500'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2">
          {/*
            Le radio natif est conservé et visible : le masquer obligerait à
            réimplémenter le focus et la sémantique de groupe pour un gain
            purement esthétique. L'`aria-label` remplace l'énoncé du contenu de
            la carte — sans lui, un lecteur d'écran lirait « 22 min, 3, 11, 6 ».
          */}
          <input
            type="radio"
            name="itinerary"
            value={itinerary.id}
            checked={selected}
            onChange={onSelect}
            aria-label={describeItinerary(itinerary, position, total)}
            className="mt-0.5 accent-primary"
          />
          {bestReason && (
            <span className="rounded-full bg-primary px-[10px] py-1 text-xs font-semibold text-white">
              {bestReason}
            </span>
          )}
        </span>

        <b aria-hidden="true" className="shrink-0 font-display text-lg leading-none text-ink">
          {itinerary.durationMinutes} min
        </b>
      </div>

      {/*
        Séquence de modes. `aria-hidden` sur tout le bloc : la phrase de
        l'`aria-label` la dit déjà en toutes lettres et dans le bon ordre, la
        relire pastille par pastille rallongerait l'écoute sans rien apprendre.
      */}
      <ol aria-hidden="true" className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {legs.map((leg, index) => (
          <li key={leg.key} className="flex items-center gap-1.5">
            {index > 0 && <span className="text-ink-200">›</span>}
            <span className="flex items-center gap-1 text-xs font-semibold text-ink-700">
              {/*
                La couleur du mode est portée par une **pastille**, pas par le
                texte : les couleurs de la charte sont validées à 3:1 sur blanc
                (seuil des objets graphiques, WCAG 1.4.11 — cf.
                `route-map-layers.test.ts`), et le vert vélo n'atteint pas les
                4.5:1 qu'exigerait du texte courant. Elle reste de toute façon
                redondante : l'icône et le libellé disent déjà le mode.
              */}
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: leg.color }}
              />
              {leg.icon}
              {leg.line && <span>{leg.line}</span>}
              {leg.durationMinutes}
            </span>
          </li>
        ))}
      </ol>

      <div
        aria-hidden="true"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500"
      >
        {/*
          Emplacement du badge CO₂ de la maquette. Le ticket ne demandait que de
          le réserver ; la donnée existant depuis UF-401, il est rempli.
        */}
        <span className="font-bold text-primary-dark">
          🌱 {formatCarbon(itinerary.carbonGrams)}
        </span>
        {itinerary.accessible && <span className="font-bold text-action-dark">♿ Accessible</span>}
        {clock && (
          <span className="ml-auto">
            {clock.departure} → {clock.arrival}
          </span>
        )}
      </div>
    </label>
  );
}
