import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Données de connexion (F1).
 * Validation d'entrée systématique (C4) ; messages d'erreur volontairement
 * génériques côté service pour ne pas révéler l'existence d'un compte.
 */
export class LoginDto {
  /** Email du compte. */
  @ApiProperty({ example: 'marie@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** Mot de passe du compte. */
  @ApiProperty({ example: 'Tr0p-Secret!2026' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
