import { ConflictException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

import { PrismaService } from '../../prisma/prisma.service';
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
 * `register` est branché sur la base (UF-102) : le mot de passe est haché en
 * argon2id (C4) puis l'utilisateur est inséré via Prisma ; un email déjà pris
 * remonte un 409 propre (jamais un 500). `login` reste un stub tant que UF-103
 * n'est pas fait.
 *
 * Le JWT émis est RÉELLEMENT signé (JWT_SECRET du .env), ce qui permet de tester
 * le guard global et le flux complet de la section 4 via Swagger.
 *
 * Couvre : F1, C4 (hash argon2, JWT signé/expirant), C11 (token destiné à un
 * cookie httpOnly).
 */
@Injectable()
export class AuthService {
  /** Identifiant factice stable, utilisé par le stub `login` tant que UF-103 n'est pas branché sur la base. */
  static readonly MOCK_USER_ID = '00000000-0000-4000-8000-000000000001';

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Inscrit un nouvel utilisateur : hash argon2id du mot de passe (C4) puis
   * création du compte en base. Le mot de passe en clair n'est jamais stocké
   * ni journalisé (C11).
   * @param dto Email + mot de passe validés par class-validator (C4)
   * @returns Un token signé et le profil minimal créé
   * @throws ConflictException (409) si l'email est déjà utilisé
   */
  async register(dto: RegisterDto): Promise<AuthResponse> {
    // Email normalisé (unicité insensible à la casse ; l'index @unique est exact).
    const email = dto.email.trim().toLowerCase();
    // argon2id par défaut (résistant GPU + side-channel) — recommandation OWASP (C4).
    const passwordHash = await argon2.hash(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true },
      });
      return this.issueToken(user.id, user.email);
    } catch (error) {
      // P2002 = violation de contrainte d'unicité (email déjà pris) : 409, pas 500 (C4).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }
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
