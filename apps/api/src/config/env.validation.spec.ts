import { validateEnv } from './env.validation';

/**
 * Tests du schéma de configuration (UF-004).
 * Vérifie la recette du ticket : l'API refuse de démarrer avec une erreur
 * explicite si une variable obligatoire manque ou est invalide (C4).
 */
describe('validateEnv', () => {
  /** Configuration minimale valide (miroir de apps/api/.env.example). */
  const validConfig = {
    PORT: '3001',
    CORS_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://urbanflow:secret@localhost:5433/urbanflow?schema=public',
    JWT_SECRET: 'a'.repeat(32),
    JWT_EXPIRES_IN: '15m',
    OTP_BASE_URL: 'http://localhost:8080',
    OTP_TIMEOUT_MS: '8000',
  };

  it('accepte une configuration complète et convertit PORT en nombre', () => {
    const env = validateEnv(validConfig);

    expect(env.PORT).toBe(3001);
    expect(env.DATABASE_URL).toBe(validConfig.DATABASE_URL);
  });

  it('rejette une configuration sans DATABASE_URL avec une erreur explicite (recette UF-004)', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = validConfig;

    expect(() => validateEnv(withoutDb)).toThrow(/DATABASE_URL/);
    expect(() => validateEnv(withoutDb)).toThrow(/refuses to start/);
  });

  it('rejette un JWT_SECRET trop court (C4/C11)', () => {
    expect(() => validateEnv({ ...validConfig, JWT_SECRET: 'too-short' })).toThrow(
      /JWT_SECRET must be at least 32 characters long/,
    );
  });

  it('rejette un PORT hors plage', () => {
    expect(() => validateEnv({ ...validConfig, PORT: '70000' })).toThrow(/PORT/);
  });

  it("rejette une CORS_ORIGIN qui n'est pas une URL", () => {
    expect(() => validateEnv({ ...validConfig, CORS_ORIGIN: 'not-a-url' })).toThrow(/CORS_ORIGIN/);
  });

  it('rejette une OTP_BASE_URL absente (UF-302)', () => {
    const { OTP_BASE_URL: _omitted, ...withoutOtp } = validConfig;

    expect(() => validateEnv(withoutOtp)).toThrow(/OTP_BASE_URL/);
  });

  it('rejette un OTP_TIMEOUT_MS hors plage (UF-302)', () => {
    // Un délai démesuré immobiliserait la requête d'un usager en mobilité pour
    // une source qui, de toute façon, est optionnelle (C5/C10).
    expect(() => validateEnv({ ...validConfig, OTP_TIMEOUT_MS: '120000' })).toThrow(
      /OTP_TIMEOUT_MS/,
    );
  });

  it("n'inclut jamais la valeur reçue dans le message d'erreur (pas de fuite de secret — C11)", () => {
    const leakedSecret = 'super-secret-value-that-must-not-leak';
    let message = '';

    try {
      validateEnv({ ...validConfig, PORT: leakedSecret });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('PORT');
    expect(message).not.toContain(leakedSecret);
  });
});
