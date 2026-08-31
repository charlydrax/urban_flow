'use client';

import type { Itinerary, ItinerarySortKey } from '@urbanflow/shared';
import { useState } from 'react';

import {
  applyItineraryView,
  describeItineraryView,
  itineraryHighlights,
  type ItineraryViewKey,
} from '../../lib/itinerary-cards';
import { ItineraryCard } from './itinerary-card';
import { ItineraryFilters } from './itinerary-filters';

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
 * ## Quatre vues, dont une qui n'affirme rien (UF-503, élargi par UF-804)
 *
 * La liste s'ouvre **dans l'ordre publié par le serveur**, annoncé par
 * `sortedBy` — par défaut l'empreinte croissante, puisque la priorité « écolo »
 * est le défaut du profil de mobilité (`DEFAULT_PREFERENCES`, côté API). Le
 * bandeau de filtres permet de la relire par durée, par empreinte ou par
 * nombre de titres de transport ; ce choix est une **vue**, pas une préférence :
 *
 * ```
 * réponse serveur ──► sortedBy ──► vue « Tous » (l'ordre du serveur, tel quel)
 *                                      │
 *                        clic « Rapide » ▼
 *                                  vue = durationAsc   (état local, non persisté)
 *                                      │
 *                     nouvelle recherche ▼
 *                                  vue = « Tous »      (le serveur reprend la main)
 * ```
 *
 * Le troisième temps est ce qui tient la recette « sans en faire le défaut » :
 * une bascule oubliée sur « Rapide » ne suit pas l'usager d'une recherche à la
 * suivante. Il est obtenu en **remettant l'état à zéro quand `sortedBy`
 * change**, plutôt qu'en faisant confiance au démontage du composant : celui-ci
 * a lieu aujourd'hui (l'écran affiche un squelette pendant le calcul), mais
 * c'est un détail de mise en page, et une liste qui resterait montée pendant
 * une recherche garderait sinon la vue précédente sans que rien ne le signale.
 *
 * UF-804 a déplacé la vue par défaut d'« Écologique » vers « Tous ». La
 * différence n'est pas cosmétique : l'ancien défaut **dupliquait** côté client
 * le tri que le serveur venait d'appliquer, ce qui tombait juste tant que le
 * profil était « écolo » et affichait une pastille mensongère dès qu'il ne
 * l'était plus. « Tous » ne trie rien et se contente d'annoncer, sous le
 * décompte, ce que `sortedBy` dit avoir été fait.
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
 * rien à réorganiser, seule la largeur du conteneur change. Le décompte et le
 * bandeau de filtres sont **empilés** depuis UF-804 : à quatre pastilles, les
 * mettre sur la même ligne que le décompte les faisait passer à la ligne une à
 * une dans la colonne de 360 px, ce qui donnait une hauteur qui variait selon
 * la longueur du décompte. Empilés, ils tiennent sur deux lignes stables.
 *
 * Le vide, l'attente et le mode dégradé sont gérés par `PlannerScreen`
 * (UF-405) : cette liste rend `null` plutôt qu'un cadre creux, et n'a pas à
 * savoir *pourquoi* elle est vide — « aucun trajet » et « aucune source n'a
 * répondu » ne se disent pas pareil, mais cela se décide au-dessus d'elle.
 */
export function ItineraryList({ itineraries, selectedId, sortedBy, onSelect }: ItineraryListProps) {
  // Vue demandée par l'usager. Le défaut est « Tous », c'est-à-dire l'ordre
  // publié par le serveur : c'est la pastille sombre de la planche, et la seule
  // valeur qui n'affirme rien que le serveur n'ait fait.
  const [view, setView] = useState<ItineraryViewKey>('all');

  // Remise à zéro sur changement de prop, selon le motif React officiel
  // (ajustement d'état pendant le rendu, pas d'`useEffect`) : un effet
  // provoquerait un premier rendu avec l'ancienne vue, donc un réordonnancement
  // visible des cartes juste après l'arrivée des résultats.
  const [lastServerSort, setLastServerSort] = useState(sortedBy);
  if (sortedBy !== lastServerSort) {
    setLastServerSort(sortedBy);
    setView('all');
  }

  if (itineraries.length === 0) return null;

  // Les mises en avant sont calculées sur la liste **du serveur**, avant retri :
  // son ordre est le départage des ex æquo, et il ne doit pas dépendre de la vue.
  const highlights = itineraryHighlights(itineraries);
  const visible = applyItineraryView(itineraries, view);
  const viewLabel = describeItineraryView(view, sortedBy);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-bold text-ink">
        Itinéraires proposés&nbsp;: {itineraries.length}
        <span className="ml-1 font-normal text-ink-500">— {viewLabel}</span>
      </p>

      <ItineraryFilters value={view} onChange={setView} />

      {/*
        `aria-live` sur le décompte plutôt que sur la liste : un retri ne change
        aucune carte, seulement leur ordre. Réannoncer les quatre à chaque
        bascule noierait l'information utile — « c'est maintenant classé par
        durée » — sous la relecture de tout le panneau (C7).
      */}
      <p aria-live="polite" className="sr-only">
        Itinéraires {viewLabel}.
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
