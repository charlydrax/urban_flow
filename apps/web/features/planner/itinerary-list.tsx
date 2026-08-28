'use client';

import type { Itinerary, ItinerarySortKey } from '@urbanflow/shared';
import { useState } from 'react';

import { SORT_LABELS, itineraryHighlights, sortItineraries } from '../../lib/itinerary-cards';
import { ItineraryCard } from './itinerary-card';
import { ItinerarySortToggle } from './itinerary-sort-toggle';

export interface ItineraryListProps {
  itineraries: readonly Itinerary[];
  selectedId: string | null;
  sortedBy: ItinerarySortKey | null;
  onSelect: (itineraryId: string) => void;
}

/**
 * Panneau de résultats du planificateur (UF-404) — la liste de cartes qui
 * permet de **comparer** les options et d'en choisir une.
 *
 * Remplace `itinerary-switcher.tsx`, que UF-403 avait livré comme strict
 * minimum pour rendre le tracé pilotable en attendant ce ticket.
 *
 * ## Un groupe de boutons radio, pas une liste de boutons
 *
 * Choisir un itinéraire, c'est en désigner **un parmi plusieurs** et non
 * déclencher autant d'actions indépendantes. Le motif radio est ce qui le dit
 * aux technologies d'assistance, et il apporte gratuitement la navigation aux
 * flèches — au `Tab` on entre dans le groupe et on en sort, sans le traverser
 * option par option (C7 — WCAG 4.1.2). Avec quatre cartes de six lignes
 * chacune, la différence à la navigation clavier n'est pas théorique.
 *
 * ## Le tri par empreinte est le défaut, la durée est l'alternative (UF-503)
 *
 * La liste s'ouvre **dans l'ordre publié par le serveur**, annoncé par
 * `sortedBy` — par défaut l'empreinte croissante, puisque la priorité « écolo »
 * est le défaut du profil de mobilité (`DEFAULT_PREFERENCES`, côté API). Le
 * sélecteur permet de relire la même liste par durée croissante ; ce choix est
 * une **vue**, pas une préférence :
 *
 * ```
 * réponse serveur ──► sortedBy ──► vue initiale
 *                                      │
 *                        clic « Rapide » ▼
 *                                  vue = durationAsc   (état local, non persisté)
 *                                      │
 *                     nouvelle recherche ▼
 *                                  vue = sortedBy      (le défaut reprend la main)
 * ```
 *
 * Le troisième temps est ce qui tient la recette « sans en faire le défaut » :
 * une bascule oubliée sur « Rapide » ne suit pas l'usager d'une recherche à la
 * suivante. Il est obtenu en **remettant l'état à zéro quand `sortedBy`
 * change**, plutôt qu'en faisant confiance au démontage du composant : celui-ci
 * a lieu aujourd'hui (l'écran affiche un squelette pendant le calcul), mais
 * c'est un détail de mise en page, et une liste qui resterait montée pendant
 * une recherche garderait sinon le tri précédent sans que rien ne le signale.
 *
 * ## La mise en avant ne dépend plus de la position
 *
 * Tant que l'ordre venait du serveur seul, badger la première carte suffisait à
 * désigner la meilleure option. Ce n'est plus vrai dès qu'on peut retrier : les
 * badges « Choix vert » et « Le plus rapide » sont donc calculés sur les valeurs
 * des itinéraires (`itineraryHighlights`) et suivent leur carte où qu'elle
 * aille. L'option la plus écologique reste mise en avant **y compris** quand la
 * liste est classée par durée — c'est là qu'elle en a le plus besoin.
 *
 * ## Le lien avec la carte
 *
 * Sélectionner une carte remonte l'identifiant à `PlannerScreen`, qui le passe
 * à la carte : `use-route-overlay` repousse alors la même source GeoJSON avec un
 * `selected` différent, met l'itinéraire retenu en avant, estompe les autres et
 * recadre dessus. Le composant ne touche jamais MapLibre — c'est la recette 2 du
 * ticket, obtenue sans coupler la liste au moteur de rendu.
 *
 * Le retri, lui, ne touche pas à la carte : réordonner des cartes ne change ni
 * les tracés ni l'itinéraire retenu. Une bascule qui déplacerait la sélection
 * ferait bouger la caméra pour une raison purement cosmétique.
 *
 * ## Mobile-first (C2)
 *
 * Les cartes s'empilent sur toute la largeur et ne dépendent d'aucun point de
 * rupture : c'est la mise en page de la maquette mobile. À partir de `md`, la
 * colonne du planificateur les contient telles quelles, à côté de la carte —
 * rien à réorganiser, seule la largeur du conteneur change. L'en-tête met le
 * décompte et le sélecteur sur une ligne, et les laisse passer l'un sous
 * l'autre quand la colonne est trop étroite.
 *
 * Le vide, l'attente et le mode dégradé sont gérés par `PlannerScreen`
 * (UF-405) : cette liste rend `null` plutôt qu'un cadre creux, et n'a pas à
 * savoir *pourquoi* elle est vide — « aucun trajet » et « aucune source n'a
 * répondu » ne se disent pas pareil, mais cela se décide au-dessus d'elle.
 */
export function ItineraryList({ itineraries, selectedId, sortedBy, onSelect }: ItineraryListProps) {
  // Tri demandé par l'usager, `null` tant qu'il n'a rien demandé — c'est-à-dire
  // tant que l'ordre affiché est celui du serveur. Distinguer « pas de choix »
  // de « choix qui coïncide avec le défaut » est ce qui permet de rendre la main
  // au serveur si sa clé change, sans écraser une bascule volontaire.
  const [viewSort, setViewSort] = useState<ItinerarySortKey | null>(null);

  // Remise à zéro sur changement de prop, selon le motif React officiel
  // (ajustement d'état pendant le rendu, pas d'`useEffect`) : un effet
  // provoquerait un premier rendu avec l'ancien tri, donc un réordonnancement
  // visible des cartes juste après l'arrivée des résultats.
  const [lastServerSort, setLastServerSort] = useState(sortedBy);
  if (sortedBy !== lastServerSort) {
    setLastServerSort(sortedBy);
    setViewSort(null);
  }

  if (itineraries.length === 0) return null;

  // `sortedBy` est absent tant qu'aucune réponse n'est arrivée. Le repli sur
  // l'empreinte n'est pas arbitraire : c'est le défaut du produit, et il vaut
  // mieux que l'ordre d'arrivée des sources.
  const serverDefault = sortedBy ?? 'carbonAsc';
  const activeSort = viewSort ?? serverDefault;

  // Les mises en avant sont calculées sur la liste **du serveur**, avant retri :
  // son ordre est le départage des ex æquo, et il ne doit pas dépendre de la vue.
  const highlights = itineraryHighlights(itineraries);
  const visible = sortItineraries(itineraries, activeSort);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">
          Itinéraires proposés&nbsp;: {itineraries.length}
          <span className="ml-1 font-normal text-ink-500">— {SORT_LABELS[activeSort]}</span>
        </p>

        <ItinerarySortToggle
          value={activeSort}
          serverDefault={serverDefault}
          onChange={setViewSort}
        />
      </div>

      {/*
        `aria-live` sur le décompte plutôt que sur la liste : un retri ne change
        aucune carte, seulement leur ordre. Réannoncer les quatre à chaque
        bascule noierait l'information utile — « c'est maintenant classé par
        durée » — sous la relecture de tout le panneau (C7).
      */}
      <p aria-live="polite" className="sr-only">
        Itinéraires {SORT_LABELS[activeSort]}.
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Choisir un itinéraire</legend>

        {visible.map((itinerary, index) => (
          <ItineraryCard
            key={itinerary.id}
            itinerary={itinerary}
            position={index + 1}
            total={visible.length}
            selected={itinerary.id === selectedId}
            highlight={highlights[itinerary.id]}
            onSelect={() => onSelect(itinerary.id)}
          />
        ))}
      </fieldset>
    </div>
  );
}
