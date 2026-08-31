'use client';

import { useId, useState } from 'react';

import {
  DEPART_NOW,
  TRAVELLER_CHOICES,
  clampTravellers,
  departureLabel,
  toDateTimeLocalValue,
  travellersLabel,
  type TripOptions,
} from '../../lib/trip-options';

export interface TripOptionsChipsProps {
  options: TripOptions;
  onChange: (next: TripOptions) => void;
}

/**
 * Chips « heure de départ » et « voyageurs » du planificateur (UF-804) —
 * la ligne de deux pastilles posée sous les champs de trajet sur la planche
 * Figma (« 4. PLANIFICATEUR F2 » : « 🕐 Maintenant » · « 👥 1 personne »).
 *
 * ## Des pastilles qui sont vraiment des contrôles
 *
 * Sur la planche, ce sont des `badge` — un fond gris, un texte, rien de plus.
 * Ici ce sont des **contrôles de formulaire natifs déguisés** : un
 * `<input type="datetime-local">` et un `<select>`, stylés en pastille. Le
 * détour par un menu maison aurait coûté un piège à focus, une gestion clavier
 * à réécrire et un composant de date à embarquer (C5) ; les contrôles natifs
 * apportent gratuitement le clavier, le lecteur d'écran, le sélecteur de date
 * du système et, sur mobile, la roulette tactile que personne ne sait mieux
 * dessiner qu'un OS.
 *
 * Le compromis assumé est visuel : le rendu exact d'un `datetime-local` dépend
 * du navigateur. On ne cherche donc pas le pixel de la planche sur ce contrôle,
 * seulement sa **place** et son rôle dans l'écran.
 *
 * ## L'heure : deux états, pas un champ toujours ouvert
 *
 * La chip s'ouvre sur « Maintenant », qui est l'immense majorité des recherches
 * et le seul état où **aucune** date ne part au serveur (voir `toPlanOptions`).
 * Le champ de date n'apparaît qu'après un clic : afficher en permanence un
 * `datetime-local` pré-rempli à l'instant présent donnerait une valeur qui
 * vieillit à l'écran, et pousserait à envoyer une date là où le moteur doit
 * décider lui-même de « maintenant ».
 *
 * Le retour à « Maintenant » reste accessible tant que le champ est ouvert :
 * un état dans lequel on entre sans pouvoir en sortir est un piège (C7).
 *
 * ## Accessibilité (C7)
 *
 * Chaque contrôle porte un `<label>` visible ou relié : « Heure de départ »,
 * « Nombre de voyageurs ». Les pictogrammes sont `aria-hidden` et doublés du
 * texte — un emoji horloge énoncé par NVDA donne « horloge à trois heures »,
 * ce qui n'est pas une alternative acceptable (WCAG 1.1.1). Les cibles font au
 * moins 44 px de haut (WCAG 2.5.5).
 */
export function TripOptionsChips({ options, onChange }: TripOptionsChipsProps) {
  const timeFieldId = useId();
  const travellersFieldId = useId();

  /**
   * Le champ de date est-il déplié ? Initialisé sur l'état réel des options —
   * une recherche rejouée avec une heure choisie doit rouvrir sur ce champ, pas
   * sur une pastille « Maintenant » qui contredirait la requête envoyée.
   */
  const [pickingTime, setPickingTime] = useState(options.departAt !== DEPART_NOW);

  const openTimePicker = () => {
    setPickingTime(true);
    // Le champ s'ouvre sur l'instant présent, arrondi à la minute : c'est la
    // valeur que l'usager s'apprête à décaler, et lui demander de la composer
    // de zéro serait quatre gestes de plus.
    onChange({ ...options, departAt: toDateTimeLocalValue(new Date()) });
  };

  const backToNow = () => {
    setPickingTime(false);
    onChange({ ...options, departAt: DEPART_NOW });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* ------------------------------------------------ heure de départ */}
      {pickingTime ? (
        <span className="inline-flex items-center gap-1.5">
          <label htmlFor={timeFieldId} className="text-xs font-semibold text-ink-700">
            <span aria-hidden="true">🕐 </span>
            Départ
          </label>
          <input
            id={timeFieldId}
            type="datetime-local"
            value={options.departAt === DEPART_NOW ? '' : options.departAt}
            onChange={(event) => onChange({ ...options, departAt: event.target.value })}
            className="min-h-11 rounded-full border border-ink-200 bg-white px-3 text-xs font-semibold text-ink"
          />
          <button
            type="button"
            onClick={backToNow}
            className="min-h-11 rounded-full px-2 text-xs font-semibold text-action-dark underline underline-offset-2 hover:bg-tint-blue"
          >
            Partir maintenant
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={openTimePicker}
          aria-label="Heure de départ : maintenant. Choisir une autre heure"
          className="inline-flex min-h-11 items-center gap-1 rounded-full bg-surface-muted px-[11px] text-xs font-semibold text-ink-700 hover:bg-ink-200"
        >
          <span aria-hidden="true">🕐</span>
          {departureLabel(options.departAt, new Date())}
        </button>
      )}

      {/* --------------------------------------------------- voyageurs */}
      <span className="inline-flex items-center gap-1.5">
        <label htmlFor={travellersFieldId} className="text-xs font-semibold text-ink-700">
          <span aria-hidden="true">👥 </span>
          Voyageurs
        </label>
        <select
          id={travellersFieldId}
          value={options.travellers}
          onChange={(event) =>
            onChange({ ...options, travellers: clampTravellers(Number(event.target.value)) })
          }
          className="min-h-11 rounded-full border border-ink-200 bg-white px-3 text-xs font-semibold text-ink"
        >
          {TRAVELLER_CHOICES.map((count) => (
            <option key={count} value={count}>
              {travellersLabel(count)}
            </option>
          ))}
        </select>
      </span>

      {/*
        Ce que la taille du groupe change réellement, dit une fois et pas à
        chaque option : sans cela, « 4 personnes » ressemble à un champ de
        réservation, alors que c'est une contrainte de disponibilité sur les
        bornes en libre-service (UF-804). Un contrôle dont on ignore l'effet est
        un contrôle qu'on règle au hasard (C7 — WCAG 3.3.2).
      */}
      {options.travellers > 1 && (
        <p className="basis-full text-xs text-ink-500">
          Seules les stations proposant au moins {options.travellers} véhicules seront proposées.
        </p>
      )}
    </div>
  );
}
