'use client';

import { MODE_CHOICES, toggleMode, type TripOptions } from '../../lib/trip-options';

export interface ModeSelectorProps {
  options: TripOptions;
  onChange: (next: TripOptions) => void;
}

/**
 * Sélecteur de modes de transport du planificateur (UF-804) — la grille de six
 * tuiles de la planche Figma (« 4. PLANIFICATEUR F2 » : Vélo'v, Bus, Métro,
 * Tram, Trott., Marche, en trois colonnes).
 *
 * ## Des cases à cocher, pas des boutons
 *
 * Chaque tuile est une **case à cocher** : les modes ne s'excluent pas, on en
 * retient plusieurs. C'est ce qui distingue ce contrôle du bandeau de filtres
 * du panneau de résultats (`ItineraryFilters`), qui est un groupe radio parce
 * qu'on n'y retient qu'une vue. Un lecteur d'écran annonce donc « case à cocher,
 * cochée » et non « bouton », et la barre d'espace fait ce qu'on en attend
 * (C7 — WCAG 4.1.2).
 *
 * La case native est masquée visuellement mais **pas** retirée du flux
 * (`sr-only`) : elle garde le focus clavier, et l'anneau de focus est repeint
 * sur la tuile qui la contient, via `has-[:focus-visible]`.
 *
 * ## Pourquoi la case est *dans* l'étiquette, et pas à côté
 *
 * Le reste du produit utilise le motif `peer` : un `<input>` en `sr-only` suivi
 * d'un `<label for>` frère, stylé d'après l'état de la case. C'est plus court, et
 * c'est ce que faisait la première version de ce composant. L'audit responsive
 * (UF-606) l'a rejeté, et il avait raison : il remonte du contrôle vers son
 * ancêtre cliquable pour mesurer la **vraie** cible tactile, et un `<label>`
 * frère n'est pas un ancêtre. Les six cases se sont donc présentées comme six
 * cibles de 1 × 1 px — ce qu'elles sont littéralement, `sr-only` étant un carré
 * d'un pixel.
 *
 * L'imbrication rend la mesure exacte pour tout le monde : l'outil d'audit, les
 * technologies d'assistance, et le doigt de l'usager, qui vise une tuile de
 * 62 px de haut (WCAG 2.5.5). Le prix est de passer de `peer-*` à `has-[…]`,
 * que le projet emploie déjà ailleurs (`has-[:disabled]:` sur l'écran de
 * connexion).
 *
 * ## Ce que la sélection fait vraiment
 *
 * C'est un **filtre dur** côté serveur : un itinéraire qui emprunte un mode
 * décoché n'est pas proposé (`usesOnlySelectedModes`, côté API). Ce n'est pas la
 * même chose que les « modes favoris » du profil de mobilité (F1), qui
 * départagent à qualité égale sans jamais exclure. La différence est délibérée
 * et documentée dans `PlanRouteRequest.modes` : un goût durable ne s'oppose pas
 * à quelqu'un le jour où seul un bus circule, mais une case décochée doit être
 * respectée — sinon l'écran ment.
 *
 * Deux conséquences visibles ici :
 *
 * 1. **la dernière case ne se décoche pas** (`toggleMode` refuse le geste) :
 *    une sélection vide ne laisserait aucune proposition constructible, et
 *    rendrait une liste vide inexplicable (C10) ;
 * 2. **décocher « Marche » ne veut pas dire « ne pas marcher »** : tout
 *    itinéraire multimodal commence et finit à pied. Cela retire la marche
 *    *seule* — ce que la note sous la grille explique, plutôt que de laisser
 *    l'usager le déduire d'un résultat surprenant (WCAG 3.3.2).
 *
 * ## L'écart assumé sur les couleurs
 *
 * La planche peint chaque tuile retenue de la couleur vive de son mode, texte
 * compris. Plusieurs de ces couples échouent au seuil AA à 12 px : le vert 500
 * sur vert 50 donne 3.1:1 là où 4.5:1 sont exigés. La tuile retenue garde donc
 * la **bordure** et le **fond teinté** de la charte — c'est ce qui porte
 * l'identité du mode — mais son texte passe en Ink 900, qui tient le contraste
 * sur tous les fonds teintés du design system (C7 — WCAG 1.4.3).
 *
 * L'état retenu ne se lit d'ailleurs jamais à la seule couleur : la case cochée
 * l'annonce aux technologies d'assistance, et le texte passe en gras (WCAG 1.4.1).
 */
export function ModeSelector({ options, onChange }: ModeSelectorProps) {
  const onlyOneLeft = options.modes.length === 1;

  return (
    <fieldset>
      <legend className="text-[13px] font-bold text-ink">Modes de transport</legend>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {MODE_CHOICES.map((choice) => {
          const selected = options.modes.includes(choice.mode);
          // Le dernier mode retenu ne peut pas être décoché : plutôt que de
          // laisser le clic échouer en silence, la case est désactivée et le
          // dit. Un contrôle qui ne réagit pas sans expliquer pourquoi est un
          // défaut d'interface, pas une protection.
          const locked = selected && onlyOneLeft;

          return (
            <label
              key={choice.mode}
              title={locked ? 'Gardez au moins un mode de transport' : undefined}
              className={`flex min-h-[62px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 px-1 py-2 text-center text-xs transition-colors has-[:disabled]:cursor-not-allowed has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-action ${
                selected
                  ? 'font-bold text-ink'
                  : 'border-ink-200 bg-white font-medium text-ink-500 hover:border-ink-500'
              }`}
              style={
                selected
                  ? // Couleur du mode, la **même** que celle de son tracé sur la
                    // carte : c'est ce qui relie la tuile au trait dessiné. Le
                    // fond en reprend la teinte à 12 %, ce qui reste sous le
                    // seuil où le texte Ink 900 perdrait son contraste.
                    { borderColor: choice.color, backgroundColor: `${choice.color}1f` }
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={selected}
                disabled={locked}
                onChange={() => onChange(toggleMode(options, choice.mode))}
                className="sr-only"
              />
              <span aria-hidden="true" className="text-base leading-none">
                {choice.icon}
              </span>
              {choice.label}
            </label>
          );
        })}
      </div>

      {/*
        Décocher « Marche » est le seul geste de cette grille dont l'effet n'est
        pas devinable : la marche reste praticable dans tous les itinéraires,
        seule la marche *seule* disparaît. Le dire ici évite que l'usager ne
        conclue que la case est cassée (C7 — WCAG 3.3.2).
      */}
      <p className="mt-2 text-xs text-ink-500">
        La marche relie toujours les segments&nbsp;; la décocher retire seulement les itinéraires
        entièrement à pied.
      </p>
    </fieldset>
  );
}
