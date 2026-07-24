/**
 * Priorité de calcul d'un itinéraire, choisie dans le profil de mobilité (F1)
 * et appliquée par le planificateur multimodal (F2) au tri des options.
 * Vocabulaire commun front/back (C9) : le front affiche le choix « rapide / écolo »,
 * le back trie les itinéraires en conséquence.
 */
export enum RoutePriority {
  /** « Rapide » : minimise la durée de trajet. */
  FASTEST = 'FASTEST',
  /** « Écolo » : minimise l'empreinte CO₂ (choix par défaut du produit). */
  GREENEST = 'GREENEST',
}
