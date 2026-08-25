/** Millisecondes dans une journée — base des comparaisons de calendrier. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Minuit local du jour d'une date : ce qui permet de comparer des journées, pas des instants. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Formate la date d'une recherche enregistrée pour la liste des trajets récents
 * (UF-204).
 *
 * On ne dit pas « il y a 3 heures » mais « aujourd'hui, 09:12 » : dans une liste
 * de rappels, l'utilisateur cherche à **reconnaître** un trajet, pas à mesurer un
 * délai. « Hier » et « aujourd'hui » situent immédiatement ; au-delà, la date
 * courte suffit et l'heure devient du bruit.
 *
 * Accessibilité (C7) : le libellé est explicite hors contexte, ce qui permet de
 * l'inclure tel quel dans le `aria-label` du bouton de rappel.
 *
 * @param isoDate Horodatage ISO 8601 renvoyé par l'API
 * @param now Instant de référence — paramétrable pour les tests
 * @returns Libellé court en français, ou chaîne vide si la date est inexploitable
 */
export function formatSearchDate(isoDate: string, now: Date = new Date()): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';

  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  if (days === 0) return `aujourd’hui, ${time}`;
  if (days === 1) return `hier, ${time}`;
  // Une date future n'a rien à faire dans un historique (horloge client décalée) :
  // on la traite comme « aujourd'hui » plutôt que d'afficher « il y a -1 jour ».
  if (days < 0) return `aujourd’hui, ${time}`;

  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
