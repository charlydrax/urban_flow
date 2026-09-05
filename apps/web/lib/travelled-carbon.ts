import type { Itinerary } from '@urbanflow/shared';

import type { RouteProgress } from './route-progress';

/**
 * Empreinte carbone **déjà émise** sur un trajet en cours (UF-701).
 *
 * Module pur, sans React ni carte : il prend l'itinéraire suivi et la
 * progression calculée par `route-progress.ts`, et rend les grammes du chemin
 * parcouru. C'est le compteur que le panneau de guidage incrémente segment
 * après segment, en simulation comme sur le terrain.
 *
 * ## Pourquoi un compteur qui monte, et pas seulement un total
 *
 * L'empreinte de l'itinéraire est affichée dès la planification (UF-401/501) :
 * la question « combien coûte ce trajet ? » a déjà sa réponse avant qu'on
 * parte. Ce compteur-ci répond à une autre question, celle qu'on se pose en
 * route : « combien ai-je déjà émis ? ». Un total figé n'y répond pas, et
 * surtout il ne montre pas ce que le produit cherche à faire voir — que
 * l'empreinte ne monte pas au même rythme selon le mode, presque pas pendant
 * les vingt minutes de vélo, d'un coup pendant les six minutes de bus.
 *
 * ## Les grammes ne sont pas recalculés ici
 *
 * Ils sont lus sur `RouteSegment.carbonGrams`, que le Service Carbone a publié
 * à l'étape 6 du flux. Le client ne refait aucun barème : refaire le calcul
 * dans le navigateur donnerait deux autorités sur le même chiffre, et donc,
 * tôt ou tard, deux chiffres — le badge de la carte de résultat et le compteur
 * du guidage afficheraient des valeurs différentes pour un même trajet.
 *
 * C'est la même règle qu'aux écritures de trajet (UF-505/UF-807), où le client
 * n'envoie jamais de grammes : le barème vit d'un seul côté.
 *
 * Couvre : proposition de valeur écologique (rendre l'empreinte perceptible
 * pendant le déplacement) ; C5 (aucun appel réseau — tout se déduit de données
 * déjà reçues).
 */

/**
 * Grammes déjà émis depuis le départ.
 *
 * Les segments **franchis** comptent pour leur empreinte entière ; celui en
 * cours compte **au prorata de la distance parcourue dessus**, sur le même
 * principe que la durée restante de `computeRouteProgress` — et pour la même
 * raison : c'est la seule répartition qui ne fabrique aucune donnée que le
 * serveur n'aurait pas déjà donnée. Un segment de bus à moitié fait a émis la
 * moitié de ses grammes ; prétendre le contraire supposerait de connaître le
 * profil d'émission instantané d'un autobus, que personne ne publie.
 *
 * Les segments **à venir** ne comptent pas : c'est tout l'intérêt du compteur.
 *
 * @param itinerary Itinéraire suivi, tel que le serveur l'a publié
 * @param progress Progression courante, ou `null` avant la première position
 * @returns Grammes de CO₂ émis depuis le départ — `0` tant que rien n'est parcouru
 */
export function travelledCarbonGrams(itinerary: Itinerary, progress: RouteProgress | null): number {
  if (!progress) return 0;

  const before = itinerary.segments
    .slice(0, progress.segmentIndex)
    .reduce((total, segment) => total + segment.carbonGrams, 0);

  const { segment } = progress;
  // Part du segment en cours déjà faite. Une distance nulle (deux points
  // confondus) donnerait une division par zéro : le segment est alors compté
  // pour rien, ce qu'il vaut.
  const doneRatio =
    segment.distanceMeters > 0
      ? Math.min(1, Math.max(0, 1 - progress.segmentRemainingMeters / segment.distanceMeters))
      : 0;

  return Math.round(before + segment.carbonGrams * doneRatio);
}
