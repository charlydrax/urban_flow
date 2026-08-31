/**
 * Distance lisible en français — mètres sous le kilomètre, kilomètres au-delà.
 *
 * ## Pourquoi un module à part
 *
 * La fonction vivait en privé dans `carbon-breakdown.ts`, seul endroit qui en
 * avait besoin. UF-805 en ajoute deux — la répartition par mode et le tableau
 * par trajet de la page « Mon impact » — et trois copies d'une règle
 * d'arrondi, c'est trois occasions de les voir diverger : le jour où le seuil
 * passerait à 100 m, deux écrans afficheraient la même distance différemment.
 *
 * Même parti pris que `formatCarbon` pour les grammes, dont ce module est le
 * pendant pour les mètres.
 *
 * @param meters Distance en mètres
 * @returns « 400 m » sous le kilomètre, « 4,2 km » au-delà, « 0 m » si la
 * valeur est absente ou aberrante — jamais une distance négative
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  // Le seuil du kilomètre : « 0,4 km » pour une traversée de place est moins
  // parlant que « 400 m », et « 4200 m » pour un trajet de métro l'est moins
  // que « 4,2 km ».
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
}
