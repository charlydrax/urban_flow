import { describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH, validateEmail, validatePassword } from './validation';

describe('validateEmail', () => {
  it('accepte une adresse bien formée', () => {
    expect(validateEmail('marie@example.com')).toBeNull();
  });

  it('ignore les espaces autour de la valeur', () => {
    expect(validateEmail('  marie@example.com  ')).toBeNull();
  });

  it.each(['', '   ', 'marie', 'marie@', 'marie@example', '@example.com', 'a b@c.fr'])(
    'rejette « %s »',
    (invalid) => {
      expect(validateEmail(invalid)).not.toBeNull();
    },
  );

  it('rejette une adresse dépassant la longueur maximale', () => {
    const tooLong = `${'a'.repeat(250)}@ex.fr`;
    expect(validateEmail(tooLong)).not.toBeNull();
  });
});

describe('validatePassword', () => {
  it('accepte un mot de passe conforme à la politique OWASP', () => {
    expect(validatePassword('Tr0p-Secret!2026')).toBeNull();
  });

  it('rejette un mot de passe trop court', () => {
    expect(validatePassword('Aa1!')).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it('rejette un mot de passe sans majuscule', () => {
    expect(validatePassword('tr0p-secret!2026')).not.toBeNull();
  });

  it('rejette un mot de passe sans minuscule', () => {
    expect(validatePassword('TR0P-SECRET!2026')).not.toBeNull();
  });

  it('rejette un mot de passe sans chiffre', () => {
    expect(validatePassword('Trop-Secret!!!!!')).not.toBeNull();
  });

  it('rejette un mot de passe sans caractère spécial', () => {
    expect(validatePassword('Tr0pSecret2026AB')).not.toBeNull();
  });
});
