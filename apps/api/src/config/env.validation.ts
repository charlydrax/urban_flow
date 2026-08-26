import { plainToInstance } from 'class-transformer';
import { IsInt, IsString, IsUrl, Max, Min, MinLength, validateSync } from 'class-validator';

/**
 * Schéma de validation des variables d'environnement.
 * Couvre : C4 (fail-fast si configuration invalide, pas de secret par défaut en dur).
 */
class EnvironmentVariables {
  /** Port HTTP de l'API Gateway. */
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  /** Origine autorisée pour le CORS (URL du client PWA). */
  @IsUrl({ require_tld: false, require_protocol: true })
  CORS_ORIGIN!: string;

  /** Chaîne de connexion PostgreSQL/PostGIS (consommée par Prisma). */
  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  /** Secret de signature des JWT — longueur minimale imposée (C4/C11). */
  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters long' })
  JWT_SECRET!: string;

  /** Durée de vie des access tokens (ex. "15m"). */
  @IsString()
  @MinLength(2)
  JWT_EXPIRES_IN!: string;

  /**
   * Racine du moteur de routage OpenTripPlanner auto-hébergé (UF-301).
   * Le connecteur TC y ajoute le chemin de l'API GraphQL (`/otp/gtfs/v1`).
   */
  @IsUrl({ require_tld: false, require_protocol: true })
  OTP_BASE_URL!: string;

  /**
   * Délai maximal accordé à OpenTripPlanner, en millisecondes.
   *
   * Mesuré sur le graphe lyonnais en développement : 1,7 s à 8,3 s selon la
   * charge de la machine et selon que la journée d'exploitation demandée est
   * déjà en cache côté OTP. 12 s laissent passer ce pire cas sans immobiliser la
   * requête indéfiniment ; une instance correctement dimensionnée répond bien
   * en deçà, d'où le réglage par variable d'environnement.
   *
   * Borne haute à 30 s : au-delà, l'usager en mobilité aurait abandonné depuis
   * longtemps, et la requête mobiliserait une connexion pour rien (C5/C10).
   * Passé ce délai, le mode TC est simplement ignoré (dégradation gracieuse).
   */
  @IsInt()
  @Min(1000)
  @Max(30000)
  OTP_TIMEOUT_MS!: number;
}

/**
 * Valide la configuration au démarrage de l'application.
 * Lève une erreur explicite (et empêche le boot) si une variable manque ou est invalide.
 * @param config Variables d'environnement brutes (process.env)
 * @returns Configuration typée et validée
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    // Message explicite variable par variable : indique quoi corriger et où,
    // sans jamais journaliser la valeur reçue (un secret pourrait fuiter — C11).
    const details = errors
      .map((error) => `  - ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(
      'Invalid environment configuration - the API refuses to start (fail-fast, C4).\n' +
        `Fix the following variables in apps/api/.env (see apps/api/.env.example):\n${details}`,
    );
  }
  return validated;
}
