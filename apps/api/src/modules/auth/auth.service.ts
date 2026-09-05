import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

import { UserRole } from '../../common/enums/user-role.enum';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/** Identité minimale du compte connecté (minimisation RGPD — C8). */
export interface SessionUser {
  id: string;
  email: string;
  /**
   * Rôle du compte (UF-701) — publié pour que l'interface sache quoi peindre,
   * jamais pour ouvrir un accès. L'autorisation se décide dans `RolesGuard`,
   * sur le rôle relu en base (C4 / OWASP A01).
   */
  role: UserRole;
}

/** Réponse d'authentification renvoyée par login/register. */
export interface AuthResponse {
  /** JWT signé (également posé en cookie httpOnly par le contrôleur — C11). */
  accessToken: string;
  user: SessionUser;
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
      // Aucun `role` écrit : la valeur par défaut de la colonne (`user`)
      // s'applique. L'accepter depuis le DTO d'inscription laisserait
      // n'importe qui se déclarer exploitant (élévation de privilège —
      // OWASP A01) ; le `ValidationPipe` global le refuse déjà en `400`, mais
      // la meilleure garantie reste de ne pas avoir de champ à falsifier.
      const user = await this.prisma.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true, role: true },
      });
      return this.issueToken(user.id, user.email, user.role as UserRole);
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
      select: { id: true, email: true, passwordHash: true, role: true },
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

    return this.issueToken(user.id, user.email, user.role as UserRole);
  }

  /**
   * Signe un access token JWT pour l'utilisateur donné (expiration courte — C4).
   *
   * Le rôle est inscrit dans la charge utile (UF-701) pour que le front
   * dispose de l'information au premier rendu. Il y est **figé pour la durée
   * du jeton** : c'est précisément pourquoi le `RolesGuard` ne s'en sert pas
   * et relit la base à chaque appel réservé.
   */
  private async issueToken(userId: string, email: string, role: UserRole): Promise<AuthResponse> {
    const accessToken = await this.jwtService.signAsync({ sub: userId, email, role });
    return { accessToken, user: { id: userId, email, role } };
  }
}
