import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/** Réponse d'authentification renvoyée par login/register. */
export interface AuthResponse {
  /** JWT signé (également posé en cookie httpOnly par le contrôleur — C11). */
  accessToken: string;
  user: { id: string; email: string };
}

/**
 * Service d'authentification (F1).
 *
 * ⚠️ SQUELETTE : aucune persistance ni vérification réelle pour l'instant.
 * Le JWT émis est en revanche RÉELLEMENT signé (JWT_SECRET du .env), ce qui
 * permet de tester le guard global et le flux complet de la section 4 dès
 * maintenant via Swagger.
 *
 * Implémentation cible (F1) :
 * - register : hash argon2 du mot de passe (C4), insertion User via Prisma,
 *   consentement RGPD explicite (C8).
 * - login : vérification argon2, message d'erreur générique (pas d'énumération
 *   de comptes — C4), émission du JWT.
 *
 * Couvre : F1, C4 (JWT signé/expirant), C11 (token destiné à un cookie httpOnly).
 */
@Injectable()
export class AuthService {
  /** Identifiant factice stable, utilisé par tous les stubs tant que F1 n'est pas branché sur la base. */
  static readonly MOCK_USER_ID = '00000000-0000-4000-8000-000000000001';

  constructor(private readonly jwtService: JwtService) {}

  /**
   * Inscrit un nouvel utilisateur (stub : aucune écriture en base).
   * @param dto Email + mot de passe validés par class-validator (C4)
   * @returns Un token signé et le profil minimal créé
   */
  async register(dto: RegisterDto): Promise<AuthResponse> {
    // TODO(F1): hash argon2 + création User en base + consentement RGPD (C8)
    return this.issueToken(AuthService.MOCK_USER_ID, dto.email);
  }

  /**
   * Connecte un utilisateur existant (stub : accepte tout couple email/mot de passe valide).
   * @param dto Identifiants validés par class-validator (C4)
   * @returns Un token signé et le profil minimal
   */
  async login(dto: LoginDto): Promise<AuthResponse> {
    // TODO(F1): vérification argon2 + erreur 401 générique si échec (C4)
    return this.issueToken(AuthService.MOCK_USER_ID, dto.email);
  }

  /** Signe un access token JWT pour l'utilisateur donné (expiration courte — C4). */
  private async issueToken(userId: string, email: string): Promise<AuthResponse> {
    const accessToken = await this.jwtService.signAsync({ sub: userId, email });
    return { accessToken, user: { id: userId, email } };
  }
}
