import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { AuthResponse, AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/**
 * Contrôleur d'authentification (F1) — endpoints publics par nature.
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

  /** Connexion d'un utilisateur existant (stub — accepte tout identifiant bien formé). */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion (stub squelette : signe un vrai JWT de test)' })
  @ApiOkResponse({ description: 'Connexion réussie, JWT émis (cookie httpOnly + corps).' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const auth = await this.authService.login(dto);
    this.setAuthCookie(res, auth.accessToken);
    return auth;
  }

  /**
   * Pose le cookie d'authentification.
   * httpOnly + SameSite=lax (C11) ; `secure` sera forcé en production (HTTPS — C4).
   */
  private setAuthCookie(res: Response, token: string): void {
    res.cookie('access_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
}
