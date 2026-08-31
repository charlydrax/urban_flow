'use client';

import type { RealtimeCard } from '../../lib/realtime-cards';

export interface RealtimeCardsProps {
  cards: readonly RealtimeCard[];
}

/**
 * Les deux encarts « données F3 » du bas de l'écran de résultats (UF-804) —
 * station en libre-service et prochain départ, tels que maquettés sur la
 * planche (« 5. RÉSULTATS F2+F3 »).
 *
 * ## Un rendu, deux cartes, aucun cas particulier
 *
 * Le composant reçoit une **liste déjà décidée** (`lib/realtime-cards.ts`) et
 * ne fait que la peindre. C'est ce qui lui permet de n'avoir aucune branche :
 * une station absente ou une option sans transport en commun ne produisent
 * simplement pas d'entrée, et la section disparaît d'elle-même quand elle est
 * vide. La règle du reste du produit — on n'affiche pas un cadre creux pour
 * tenir la mise en page (UF-405).
 *
 * ## Ce n'est pas une liste de choix
 *
 * Contrairement aux cartes d'itinéraires, celles-ci ne se sélectionnent pas :
 * ce sont des **informations**, pas des options. Elles sont donc rendues en
 * `<li>` dans une liste nommée, et non en boutons radio — un élément
 * interactif qui ne fait rien est pire qu'un élément statique (C7 — WCAG 4.1.2).
 *
 * ## Provenance et fraîcheur
 *
 * Chaque carte porte sa source à droite (« GBFS · temps réel », « GTFS ·
 * horaire théorique »). Ce n'est pas une mention légale : c'est la différence
 * entre un nombre de vélos vérifiable à la minute et un horaire publié. Une
 * source signalée figée passe la carte en teinte d'alerte douce — la donnée
 * reste affichée, nuancée (C10).
 *
 * Accessibilité (C7) : la section est nommée, chaque carte porte une phrase
 * complète en `aria-label` sur son contenu — les fragments visuels (« À 3 min »,
 * « 7 véhicules ») n'ont aucun sens énoncés isolément. Le pictogramme est
 * décoratif ; la mise en avant se lit au gras **et** au texte, jamais à la
 * seule couleur (WCAG 1.4.1).
 */
export function RealtimeCards({ cards }: RealtimeCardsProps) {
  if (cards.length === 0) return null;

  return (
    <section aria-labelledby="realtime-title" className="flex flex-col gap-2">
      <h2 id="realtime-title" className="text-sm font-bold text-ink">
        Autour de votre départ
      </h2>

      <ul className="flex flex-col gap-2">
        {cards.map((card) => (
          <li
            key={card.key}
            className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${
              card.stale ? 'border-warning/40 bg-tint-gold' : 'border-ink-200 bg-white'
            }`}
          >
            <span aria-hidden="true" className="text-base leading-none">
              {card.icon}
            </span>

            {/*
              `min-w-0` : sans plancher à zéro, un nom de station long
              élargirait la piste flex au-delà de la colonne et ferait défiler
              la page horizontalement — le même piège qu'en UF-606 (C2).
            */}
            <div className="min-w-0 flex-1 text-xs">
              {/*
                Phrase complète pour le lecteur d'écran, fragments pour l'œil —
                et jamais les deux à la fois.

                Un `aria-label` posé sur le paragraphe visible aurait été plus
                court à écrire, mais `aria-label` est **interdit sur un élément
                sans rôle** (axe : `aria-prohibited-attr`, WCAG 4.1.2) : sur un
                `<p>`, certaines technologies d'assistance l'ignorent purement
                et simplement, et l'alternative disparaîtrait sans que rien ne
                le signale. Un texte `sr-only` doublé d'un bloc `aria-hidden`
                est la forme qui tient dans tous les cas.
              */}
              <p className="sr-only">{card.description}</p>

              <div aria-hidden="true" className="min-w-0">
                {/*
                  Le titre se coupe, le détail se replie — et pas l'inverse.

                  Un nom de station peut faire quarante caractères sans que la
                  fin apprenne quoi que ce soit (« PART-DIEU / VILLETTE » est
                  déjà identifiable tronqué). Le détail, lui, se termine par
                  l'information que la carte existe pour donner : le nombre de
                  vélos, ou l'heure de départ. La couper revenait à afficher
                  « Arrêt Gare Part-Dieu V.Merle · … » — l'encart entier pour ne
                  rien dire, dans la colonne de 360 px du planificateur (C2).
                */}
                <span className="block truncate font-bold text-ink">{card.title}</span>
                <span className="block text-ink-500">
                  {card.detail}
                  {card.emphasis && (
                    <>
                      {' · '}
                      <strong className="font-bold text-primary-dark">{card.emphasis}</strong>
                    </>
                  )}
                </span>
              </div>
            </div>

            <span aria-hidden="true" className="shrink-0 text-[10px] text-ink-500">
              {card.provenance}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
