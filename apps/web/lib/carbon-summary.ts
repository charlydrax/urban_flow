import { CAR_REFERENCE_GRAMS_PER_KM, type CarbonPeriodTotals } from '@urbanflow/shared';

/**
 * Traduction du suivi carbone personnel en éléments d'écran (UF-505) — de la
 * réponse de `GET /api/carbon/summary` aux libellés et aux hauteurs de barres de
 * la page « Mon impact ».
 *
 * Module **pur**, sans React, comme `carbon-badge.ts` et `itinerary-cards.ts`
 * avant lui : il ne fait que mettre en forme des nombres que le serveur a
 * arrêtés. C'est ce qui le rend testable dans l'environnement `node` de Vitest,
 * où les tests de composants (jsdom) n'existent pas.
 *
 * ## Ce qu'il ne calcule pas
 *
 * **Aucun gramme.** Les totaux, la référence voiture et l'évolution viennent
 * tous de l'API. Les seuls nombres fabriqués ici sont des **grandeurs
 * d'affichage** — une part en pourcentage, une hauteur de barre, une distance
 * équivalente — qui ne ressortent jamais de l'écran et ne sont jamais réécrites
 * en base.
 *
 * Couvre : C7 (chaque proportion visuelle est doublée d'un libellé écrit,
 * WCAG 1.4.1), C5 (aucun recalcul d'empreinte côté client), C9 (les unités
 * publiées par l'API sont respectées telles quelles).
 */

/**
 * Distance qui aurait été parcourue en voiture pour émettre `grams`, en
 * kilomètres — l'indicateur « équivalent voiture évité » de la maquette.
 *
 * C'est l'opération **inverse** de la référence calculée côté serveur, au même
 * facteur (`CAR_REFERENCE_GRAMS_PER_KM`, importé de `@urbanflow/shared` et non
 * recopié) : deux copies du nombre finiraient par donner deux distances
 * différentes pour un même trajet.
 *
 * Un gramme ne parle à personne ; un nombre de kilomètres de voiture, si.
 *
 * @param grams Référence voiture publiée par l'API, en grammes de CO₂e
 * @returns Distance équivalente en kilomètres, arrondie à l'unité (jamais négative)
 */
export function carEquivalentKm(grams: number): number {
  if (!Number.isFinite(grams) || grams <= 0) return 0;
  return Math.round(grams / CAR_REFERENCE_GRAMS_PER_KM);
}

/**
 * Part des émissions **évitées** par rapport au tout-voiture, en pourcentage
 * entier — le « ↓ 76 % d'émissions évitées grâce à vos choix » de la maquette.
 *
 * `null` quand il n'y a pas de référence (aucun trajet valorisé sur la
 * période) : afficher « 0 % évité » à un compte neuf lui reprocherait une
 * inaction qui n'existe pas, alors qu'il n'a simplement rien enregistré.
 *
 * @param totals Totaux de la période, tels que publiés par l'API
 * @returns Pourcentage entre 0 et 100, ou `null` si rien à comparer
 */
export function avoidedSharePercent(totals: CarbonPeriodTotals): number | null {
  if (totals.carEquivalentGrams <= 0) return null;
  return Math.round((totals.avoidedGrams / totals.carEquivalentGrams) * 100);
}

/**
 * Hauteur d'une barre du graphique, en pourcentage de la plus haute de la série.
 *
 * L'échelle est **relative à la série affichée** et non à une valeur absolue :
 * un mois sobre et un mois chargé produisent tous deux un graphique lisible, là
 * où une échelle fixe écraserait le premier contre l'axe.
 *
 * Une valeur non nulle ne descend jamais sous 2 % : une semaine à 3 g au milieu
 * d'un mois à 5 kg doit rester **visible** comme une petite barre, sinon
 * l'écran affiche « rien » là où il s'est passé quelque chose, et le lecteur
 * conclut à un trou dans les données (C7 — WCAG 1.4.1, l'information ne doit
 * pas reposer sur un seul indice visuel).
 *
 * @param value Valeur de la tranche, en grammes
 * @param max Plus grande valeur de la série, en grammes
 * @returns Hauteur en pourcentage, entre 0 et 100
 */
export function barHeightPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}

/**
 * Libellé court d'une tranche du graphique (ex. « 5 août »), pour l'axe et
 * l'alternative textuelle.
 *
 * La date de **début** de tranche, parce que c'est elle qui situe la période
 * dans le passé du lecteur ; la fin est celle de la tranche suivante et
 * n'apporte rien de plus sur un axe.
 *
 * @param totals Tranche à étiqueter
 * @returns Jour et mois en français, ex. « 5 août »
 */
export function bucketLabel(totals: CarbonPeriodTotals): string {
  return new Date(totals.from).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/**
 * Phrase de l'indicateur d'évolution, dans le sens où un usager la comprend.
 *
 * ⚠️ Le **signe est inversé à la lecture** : une variation d'émissions négative
 * est une *bonne* nouvelle. Rendre « −20 % » tel quel à côté d'une flèche verte
 * vers le haut serait ambigu ; l'écran dit donc « −20 % d'émissions » avec une
 * direction explicite, et c'est le composant qui choisit la couleur d'après
 * `direction` plutôt que d'après le signe.
 *
 * `direction` vaut `'none'` quand il n'y a pas de comparaison possible — le
 * texte le dit alors avec des mots, sans nombre.
 *
 * @param changePercent Variation publiée par l'API, ou `null`
 * @returns Direction du changement et libellé prêt à afficher
 */
export function changeSummary(changePercent: number | null): {
  direction: 'down' | 'up' | 'flat' | 'none';
  label: string;
} {
  if (changePercent === null) {
    return { direction: 'none', label: 'Pas encore de période précédente à comparer' };
  }
  if (changePercent === 0) {
    return { direction: 'flat', label: 'Stable par rapport à la période précédente' };
  }
  if (changePercent < 0) {
    return {
      direction: 'down',
      // `Math.abs` : le signe est déjà porté par le mot « moins ». « −20 % de
      // moins » dirait le contraire de ce qu'on veut dire.
      label: `${Math.abs(changePercent)} % d’émissions en moins que la période précédente`,
    };
  }
  return {
    direction: 'up',
    label: `${changePercent} % d’émissions en plus que la période précédente`,
  };
}
