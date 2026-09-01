import type { CompleteTripPayload } from '@urbanflow/shared';

import { SelectItineraryDto } from './select-itinerary.dto';

/**
 * Corps de `POST /api/search-history/:id/completion` (UF-807) — le trajet que
 * l'usager a effectivement **parcouru**, tel que le guidage (UF-806) vient de
 * le mener à son terme.
 *
 * ## Pourquoi la même forme que la sélection
 *
 * L'arrivée valorise le trajet **et** le marque réalisé, en un seul appel.
 * Deux raisons.
 *
 * La première option de la liste est présélectionnée sans clic (UF-404) : un
 * usager qui lance le guidage dessus et arrive n'a jamais émis de sélection.
 * Exiger qu'un `PATCH .../selection` ait précédé ferait disparaître du bilan
 * des trajets bel et bien parcourus — précisément le genre d'écart que ce
 * ticket corrige, dans l'autre sens.
 *
 * Et deux appels — valoriser, puis marquer — ouvriraient une fenêtre où un
 * trajet serait réalisé sans empreinte, donc compté pour zéro gramme par le
 * tableau de bord.
 *
 * ## Ce que le corps ne porte pas
 *
 * **Aucun gramme**, comme pour la sélection : le Service Carbone valorise les
 * segments côté serveur (C4). **Aucun horodatage** non plus — l'instant
 * d'arrivée est celui du serveur. Une heure venue du navigateur permettrait de
 * ranger un trajet dans la période de son choix, et l'horloge d'un appareil
 * mobile n'est de toute façon pas une source de temps fiable.
 *
 * L'héritage tient la promesse « même corps que la sélection » à la
 * compilation : le jour où un champ y est ajouté, il l'est ici aussi.
 * class-validator et Swagger reprennent les décorateurs de la classe parente,
 * la validation et la documentation (C4/C9) sont donc identiques sans copie.
 */
export class CompleteTripDto extends SelectItineraryDto implements CompleteTripPayload {}
