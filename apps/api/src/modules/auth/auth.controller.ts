import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedUser } from '../../common/strategies/jwt.strategy';
import { AuthResponse, AuthService, SessionUser } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/** Nom du cookie portant l'access token (partagé par la pose et la purge). */
const AUTH_COOKIE = 'access_token';

/**
 * Contrôleur d'authentification (F1).
 *
 * `register` / `login` / `logout` sont publics par nature ; `me` est protégé par
 * le guard JWT global et sert de **sonde d'état de session** au front (UF-106).
 *
 * Le JWT est posé dans un cookie `httpOnly` (inaccessible au JS du navigateur,
 * protège du vol de token par XSS — C11) ET renvoyé dans le corps pour les
 * tests Swagger pendant le développement.
 *
 * Couvre : F1, C4 (validation DTO), C11 (cookie httpOnly + SameSite).
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Inscription d'un nouvel utilisateur : mot de passe haché en argon2, compte persisté (UF-102). */
  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Inscription : crée le compte (hash argon2) et émet un JWT' })
  @ApiCreatedResponse({ description: 'Compte créé, JWT émis (cookie httpOnly + corps).' })
  @ApiConflictResponse({ description: 'Email déjà utilisé.' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const auth = await this.authService.register(dto);
    this.setAuthCookie(res, auth.accessToken);
    return auth;
  }

  /** Connexion d'un utilisateur existant : vérifie email + mot de passe, émet un JWT (UF-103). */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion : vérifie email + mot de passe et émet un JWT signé' })
  @ApiOkResponse({ description: 'Connexion réussie, JWT émis (cookie httpOnly + corps).' })
  @ApiUnauthorizedResponse({ description: 'Identifiants invalides (message générique, C4/OWASP).' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const auth = await this.authService.login(dto);
    this.setAuthCookie(res, auth.accessToken);
    return auth;
  }

  /**
   * État de la session courante (UF-106).
   *
   * Route **protégée** : le guard global renvoie `401` dès que le cookie est
   * absent, altéré ou expiré. Le front s'en sert pour savoir s'il est encore
   * connecté sans jamais lire le token (impossible : `httpOnly` — C11).
   *
   * L'identité renvoyée provient exclusivement du **token vérifié**, jamais du
   * corps de la requête (anti-usurpation — C4). À distinguer de
   * `GET /api/users/me`, qui exposera le *profil applicatif* lu en base.
   */
  @Get('me')
  @ApiCookieAuth(AUTH_COOKIE)
  @ApiOperation({ summary: 'Identité du compte connecté (sonde de session du front)' })
  @ApiOkResponse({ description: 'Session valide : identité issue du JWT vérifié.' })
  @ApiUnauthorizedResponse({ description: 'Session absente, invalide ou expirée.' })
  me(@CurrentUser() user: AuthenticatedUser): SessionUser {
    return { id: user.userId, email: user.email };
  }

  /**
   * Déconnexion (UF-106) : purge le cookie de session.
   *
   * Indispensable côté serveur — le cookie étant `httpOnly`, le JavaScript du
   * navigateur ne peut pas l'effacer lui-même (C11). Volontairement `@Public()` :
   * une session déjà expirée doit pouvoir être purgée proprement (c'est
   * exactement le cas « 401 → purge + retour à la connexion »), et l'endpoint
   * n'expose aucune donnée.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Déconnexion : purge le cookie de session httpOnly' })
  @ApiNoContentResponse({ description: 'Cookie purgé (idempotent).' })
  logout(@Res({ passthrough: true }) res: Response): void {
    // Mêmes attributs qu'à la pose, sinon le navigateur ne cible pas le bon cookie.
    res.clearCookie(AUTH_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }

  /**
   * Pose le cookie d'authentification.
   * httpOnly + SameSite=lax (C11) ; `secure` sera forcé en production (HTTPS — C4).
   */
  private setAuthCookie(res: Response, token: string): void {
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
}
