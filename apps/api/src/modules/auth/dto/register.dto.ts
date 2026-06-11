import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Données d'inscription (F1).
 * Validation serveur systématique de toute entrée (C4) : email normalisé,
 * politique de mot de passe robuste (longueur + complexité, recommandations OWASP).
 */
export class RegisterDto {
  /** Adresse email de l'utilisateur — donnée personnelle (RGPD/C8), minimisée au strict nécessaire. */
  @ApiProperty({ example: 'marie@example.com', description: "Email de l'utilisateur" })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** Mot de passe en clair, transmis uniquement via HTTPS ; haché en argon2 côté serveur (C4). */
  @ApiProperty({
    example: 'Tr0p-Secret!2026',
    description: 'Au moins 12 caractères, avec majuscule, minuscule, chiffre et caractère spécial',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).*$/, {
    message: 'password must contain lowercase, uppercase, digit and special character',
  })
  password!: string;
}
