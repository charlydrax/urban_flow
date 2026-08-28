import { ApiProperty } from '@nestjs/swagger';
import type { SelectItineraryPayload, SelectedSegmentPayload } from '@urbanflow/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { TransportMode } from '../../../common/enums/transport-mode.enum';

/**
 * Un segment de l'option retenue, réduit à ce que le barème consomme (UF-505).
 *
 * Le client renvoie le mode et la distance, **pas** l'empreinte : c'est le
 * Service Carbone qui valorise, ici comme à l'étape 6 du flux. Accepter un
 * nombre de grammes venu du navigateur laisserait n'importe qui s'inscrire un
 * bilan à zéro, et un bilan qu'on peut se fabriquer n'a plus de valeur — même
 * quand la seule personne trompée est son auteur.
 */
export class SelectedSegmentDto implements SelectedSegmentPayload {
  /** Mode du segment — détermine à lui seul le facteur appliqué. */
  @ApiProperty({ enum: TransportMode, example: TransportMode.METRO })
  @IsEnum(TransportMode)
  mode!: TransportMode;

  /**
   * Distance du segment, en mètres.
   *
   * Bornée à 500 km : au-delà, ce n'est plus un déplacement urbain mais une
   * valeur qui ferait exploser un total mensuel d'un seul appel (C4).
   */
  @ApiProperty({ example: 3200, minimum: 0, maximum: 500_000 })
  @IsInt()
  @Min(0)
  @Max(500_000)
  distanceMeters!: number;
}

/**
 * Corps de `PATCH /api/search-history/:id/selection` (UF-505) — l'itinéraire
 * que l'usager a effectivement retenu parmi les propositions.
 *
 * ⚠️ Sécurité (C4) : aucun `userId`, comme partout ailleurs dans ce module. La
 * ligne visée est identifiée par son UUID **et** par le propriétaire du JWT ;
 * viser l'identifiant d'un autre compte ne modifie rien et répond 404
 * (OWASP A01).
 */
export class SelectItineraryDto implements SelectItineraryPayload {
  /** Résumé lisible de l'option retenue, tel qu'affiché sur sa carte. */
  @ApiProperty({ example: 'Marche + Métro B' })
  @IsString()
  @MinLength(1)
  // Même borne que les libellés de lieu : au-delà, c'est un abus (C4).
  @MaxLength(200)
  selectedSummary!: string;

  /**
   * Segments de l'option retenue, dans l'ordre du trajet.
   *
   * Au moins un — une sélection sans segment ne décrit aucun déplacement. Au
   * plus cinquante : un itinéraire urbain multimodal en compte une poignée, et
   * la borne empêche de faire boucler le serveur sur une liste fabriquée (C4/C5).
   */
  @ApiProperty({ type: [SelectedSegmentDto] })
  @ValidateNested({ each: true })
  @Type(() => SelectedSegmentDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  segments!: SelectedSegmentDto[];
}
