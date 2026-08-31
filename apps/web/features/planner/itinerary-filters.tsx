'use client';

import { ITINERARY_VIEWS, type ItineraryViewKey } from '../../lib/itinerary-cards';

export interface ItineraryFiltersProps {
  /** Vue actuellement appliquée à l'affichage. */
  value: ItineraryViewKey;
  onChange: (view: ItineraryViewKey) => void;
}

/**
 * Bandeau de filtres du panneau de résultats (UF-804) — les **quatre**
 * pastilles de la planche « 5. RÉSULTATS F2+F3 » : Tous, Rapide, Écolo,
 * Économe.
 *
 * Remplace `ItinerarySortToggle` (UF-503), qui n'en portait que deux. Ce n'est
 * pas qu'un ajout de boutons : la vue par défaut change de nature. UF-503
 * ouvrait la liste sur « Écologique », en dupliquant côté client le tri que le
 * serveur venait d'appliquer ; le bandeau s'ouvre maintenant sur « Tous »,
 * c'est-à-dire sur **l'ordre du serveur, quel qu'il soit**. Un compte réglé sur
 * la priorité « rapide » (F1) voit donc enfin sa liste dans son ordre, avec la
 * pastille neutre allumée — au lieu d'une pastille « Écologique » qui affirmait
 * un classement que le serveur n'avait pas fait.
 *
 * ## Toujours un retri, jamais une nouvelle recherche
 *
 * Comme en UF-503, aucune pastille ne déclenche d'appel réseau : elles
 * réordonnent les itinéraires déjà reçus. Repasser par `POST /routes/plan`
 * relancerait la collecte des trois sources — plusieurs secondes — et pourrait
 * rendre des itinéraires *différents*, alors qu'on demande seulement à lire les
 * mêmes dans un autre ordre. Zéro requête pour un changement de vue (C5).
 *
 * Ce qui change les **résultats** vit ailleurs, dans les options du formulaire
 * (heure, voyageurs, modes) : celles-là repartent au serveur. La frontière est
 * nette et se lit à l'écran — au-dessus de la carte, on demande ; en dessous,
 * on relit.
 *
 * ## Quatre boutons radio, pas quatre boutons
 *
 * Choisir une vue, c'est retenir **une** option parmi quatre qui s'excluent :
 * le motif radio le dit aux technologies d'assistance et donne la navigation
 * aux flèches, là où quatre `<button>` laisseraient croire à quatre actions
 * indépendantes (C7 — WCAG 4.1.2).
 *
 * Le radio natif est masqué visuellement mais **pas** retiré du flux
 * (`sr-only`) : il garde le focus clavier, et l'anneau de focus est repeint sur
 * la pastille qui le contient. L'état retenu se lit au fond plein *et* au texte
 * en gras, jamais à la seule couleur (WCAG 1.4.1).
 *
 * Il est **imbriqué** dans son étiquette, et non posé à côté d'elle en `peer` :
 * la vraie cible tactile est alors mesurable en remontant depuis le contrôle,
 * ce dont dépendent l'audit responsive (UF-606) comme le doigt de l'usager. Un
 * `sr-only` frère se présente comme une cible de 1 × 1 px — voir la même
 * discussion dans `mode-selector.tsx`. La pastille fait 44 px de haut
 * (WCAG 2.5.5), là où la planche en dessine 28 : quatre pastilles serrées sur
 * un écran de 375 px se ratent au pouce.
 *
 * ## L'écart assumé sur la pastille active
 *
 * La planche peint la pastille active en Ink 900 (`#0A1525`) avec du texte
 * blanc — 17:1, largement conforme. On la garde telle quelle : c'est le seul
 * endroit du produit où un fond sombre sert d'état actif hors du rail de
 * navigation (UF-803), et le contraste avec les pastilles au repos (Ink 100)
 * dépasse le 3:1 exigé pour un composant d'interface (WCAG 1.4.11).
 *
 * Couvre : C2 (le groupe passe à la ligne sous la légende sur écran étroit),
 * C5 (retri en mémoire, aucune requête), C7 (radiogroup nommé, focus visible,
 * état redondant, cibles confortables).
 */
export function ItineraryFilters({ value, onChange }: ItineraryFiltersProps) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">Filtrer les itinéraires</legend>

      {ITINERARY_VIEWS.map((view) => {
        const active = view.key === value;

        return (
          <label
            key={view.key}
            className={`inline-flex min-h-11 cursor-pointer items-center rounded-full px-3.5 text-xs transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-action ${
              active
                ? 'bg-ink font-bold text-white'
                : 'bg-surface-muted font-medium text-ink-700 hover:bg-ink-200'
            }`}
          >
            <input
              type="radio"
              name="itinerary-view"
              value={view.key}
              checked={active}
              onChange={() => onChange(view.key)}
              className="sr-only"
            />
            <span aria-hidden="true">{view.icon}&nbsp;</span>
            {view.label}
            {/*
              Le libellé seul ne dit pas ce que la pastille fait : « Économe » ne
              se devine pas, et « Tous » encore moins. La description est reprise
              ici pour le lecteur d'écran — visuellement, c'est la ligne sous le
              décompte qui la porte (C7 — WCAG 2.4.6).
            */}
            <span className="sr-only"> — itinéraires {view.description}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
