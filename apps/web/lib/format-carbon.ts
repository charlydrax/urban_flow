/**
 * Formate une empreinte carbone en libellé lisible (français).
 * Utilisé par la liste d'itinéraires et le tableau de bord carbone.
 * @param grams Empreinte en grammes de CO₂
 * @returns Libellé compact, ex. "240 g CO₂" ou "1,2 kg CO₂"
 */
export function formatCarbon(grams: number): string {
  if (grams < 1000) {
    return `${Math.round(grams)} g CO₂`;
  }
  const kg = grams / 1000;
  return `${kg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg CO₂`;
}
