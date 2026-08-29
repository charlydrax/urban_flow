import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Écrans depuis lesquels une erreur peut être signalée.
 *
 * Liste fermée, et non chaîne libre : un chemin recopié tel quel depuis le
 * navigateur emporterait la `query string`, donc potentiellement une adresse de
 * départ ou d'arrivée — une donnée de déplacement (C8/C11). Le front envoie
 * donc le **nom de l'écran**, pas son URL.
 */
export const CLIENT_ERROR_SCREENS = [
  'planner',
  'login',
  'register',
  'profile',
  'impact',
  'privacy',
  'unknown',
] as const;

/** Écran d'origine d'un signalement d'erreur front. */
export type ClientErrorScreen = (typeof CLIENT_ERROR_SCREENS)[number];

/**
 * Corps de `POST /api/diagnostics/client-errors` (UF-607).
 *
 * Une erreur qui casse l'écran de la PWA ne laisse **aucune trace serveur** :
 * la requête a réussi, c'est le rendu qui a échoué. Sans ce canal, la moitié
 * des bogues d'une préproduction ne sont connus que si un testeur pense à les
 * raconter. Le corps est donc volontairement pauvre — tout ce qui aide à
 * reproduire, rien qui désigne une personne.
 *
 * Ce que le champ `requestId` apporte : quand l'écran a planté juste après un
 * appel d'API, le front renvoie l'identifiant de cet appel, et le journal
 * serveur montre alors la requête et l'erreur d'affichage **sur la même clé**.
 */
export class ReportClientErrorDto {
  /**
   * Message d'erreur, tel que le navigateur l'a produit.
   * Borné à 300 caractères : au-delà, ce n'est plus un message, c'est un
   * transport de charge utile vers nos journaux.
   */
  @ApiProperty({ example: "Cannot read properties of undefined (reading 'segments')" })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  message!: string;

  /** Nom de la classe d'erreur (`TypeError`, `ApiError`…), quand il est connu. */
  @ApiPropertyOptional({ example: 'TypeError' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  /** Écran d'origine — voir {@link CLIENT_ERROR_SCREENS}. */
  @ApiProperty({ enum: CLIENT_ERROR_SCREENS, example: 'planner' })
  @IsIn(CLIENT_ERROR_SCREENS)
  screen!: ClientErrorScreen;

  /**
   * Identifiant de corrélation du dernier appel d'API (en-tête `X-Request-Id`).
   * Même alphabet que côté middleware : ce qui arrive ici finit dans un journal,
   * un saut de ligne y forgerait une fausse entrée (OWASP A09).
   */
  @ApiPropertyOptional({ example: '5f1d1c0a-2a6e-4f3b-9a8f-2c1d3e4f5a6b' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'requestId contains unsupported characters' })
  requestId?: string;

  /**
   * Empreinte d'erreur produite par Next.js (`error.digest`) lorsque la panne
   * vient d'un rendu serveur : elle relie le signalement à la trace que Next a
   * déjà écrite de son côté.
   */
  @ApiPropertyOptional({ example: '1873452901' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'digest contains unsupported characters' })
  digest?: string;
}
