import { SetMetadata } from '@nestjs/common';

/** Clé de métadonnée lue par le JwtAuthGuard pour identifier les routes publiques. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marque un endpoint comme public (exempté du guard JWT global).
 * À utiliser avec parcimonie : la sécurité par défaut impose l'authentification (C4).
 *
 * @example
 * ```ts
 * @Public()
 * @Post('login')
 * login(@Body() dto: LoginDto) { ... }
 * ```
 */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);
