import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
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
 * `register` (UF-102) hache le mot de passe en argon2id (C4) puis insère
 * l'utilisateur via Prisma ; un email déjà pris remonte un 409 propre (jamais
 * un 500). `login` (UF-103) vérifie l'email et le mot de passe en base et émet
 * le JWT signé (JWT_SECRET du .env) ; tout échec remonte un 401 générique.
 *
 * Le JWT émis contient l'identifiant utilisateur (`sub`) et une expiration
 * (`JWT_EXPIRES_IN`), ce qui permet de tester le guard global et le flux
 * complet de la section 4 via Swagger.
 *
 * Couvre : F1, C4 (hash argon2, JWT signé/expirant, 401 générique anti-énumération),
 * C11 (token destiné à un cookie httpOnly).
 */
@Injectable()
export class AuthService {
  /**
   * Hash argon2 factice, vérifié quand aucun compte ne correspond à l'email.
   * On paie ainsi le même coût de calcul qu'une vraie vérification pour ne pas
   * révéler par le temps de réponse si l'email existe (anti-énumération — C4/OWASP).
   * Généré une fois via `argon2.hash('login-timing-equalizer')`.
   */
  private static readonly DUMMY_PASSWORD_HASH =
    '$argon2id$v=19$m=65536,t=3,p=4$QMwbrcl6wSkHJfNRV7oLBg$sqaWa738QRHgUlnC0F4x9+pb77eUMZdOcA5KOOhtNQU';

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
   * Connecte un utilisateur existant : vérifie l'email et le mot de passe en
   * base, puis émet un JWT signé.
   *
   * Sécurité (C4 / OWASP) :
   *  - un email inconnu et un mot de passe faux remontent le MÊME 401 générique
   *    (« Invalid credentials »), sans révéler lequel est en cause ;
   *  - quand l'email n'existe pas, on vérifie tout de même un hash factice pour
   *    payer le même coût CPU qu'une vraie vérification et ne pas trahir
   *    l'existence du compte par le temps de réponse (anti-énumération).
   *
   * @param dto Identifiants validés par class-validator (C4)
   * @returns Un token signé (sub = userId, expiration) et le profil minimal
   * @throws UnauthorizedException (401) si l'email ou le mot de passe est invalide
   */
  async login(dto: LoginDto): Promise<AuthResponse> {
    // Même normalisation qu'à l'inscription (unicité insensible à la casse).
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });

    // Toujours exécuter une vérification argon2, même sans compte, pour un temps
    // de réponse constant (anti-énumération — C4).
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? AuthService.DUMMY_PASSWORD_HASH,
      dto.password,
    );

    if (!user || !passwordMatches) {
      // Message générique : ne révèle jamais si c'est l'email ou le mot de passe
      // qui est faux (recette UF-103 / bonne pratique OWASP — C4).
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueToken(user.id, user.email);
  }

  /** Signe un access token JWT pour l'utilisateur donné (expiration courte — C4). */
  private async issueToken(userId: string, email: string): Promise<AuthResponse> {
    const accessToken = await this.jwtService.signAsync({ sub: userId, email });
    return { accessToken, user: { id: userId, email } };
  }
}
