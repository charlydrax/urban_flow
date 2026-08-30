/**
 * Initiales affichées dans une pastille d'avatar (maquette « 3. PROFIL F1 »).
 *
 * ## Pourquoi ce module minuscule existe (UF-803, C5)
 *
 * La fonction vivait dans `features/profile/preferences.ts`, ce qui convenait
 * tant que la carte de compte était sa seule cliente. Le rail de navigation
 * l'appelle aussi — et le rail est monté par le **layout racine**, donc présent
 * sur chaque page. Importer `preferences.ts` depuis là, c'était tirer dans le
 * lot commun tout ce que ce module tire lui-même : les libellés du formulaire de
 * profil, et surtout les énumérations `RoutePriority` / `TransportMode` de
 * `@urbanflow/shared`, qui sont des valeurs d'exécution et non des types. Le
 * budget de poids d'UF-605 l'a vu tout de suite : **+3,5 ko gzip sur les huit
 * routes**, y compris la politique de confidentialité, qui n'a pourtant ni
 * profil ni avatar.
 *
 * Un module feuille — aucun import, une fonction pure — coûte ce qu'il pèse et
 * rien d'autre. C'est la leçon générale : ce qu'un composant de la coque importe
 * est payé par toutes les pages, y compris celles qui ne s'en servent pas.
 *
 * Fonction pure et sans dépendance : testée dans la suite `unit` (node).
 *
 * @param email Adresse du compte connecté
 * @returns Une ou deux lettres majuscules, `?` si l'adresse est inexploitable
 */
export function initialsFromEmail(email: string): string {
  const [local = ''] = email.split('@');
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : local.slice(0, 2);
  return letters.toUpperCase() || '?';
}
