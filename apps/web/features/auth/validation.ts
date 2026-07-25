/**
 * Validation d'authentification côté client (F1).
 *
 * Ces règles **dupliquent volontairement** la validation serveur (C4 : les DTO
 * `RegisterDto` / `LoginDto` de l'API restent la source de vérité et rejettent
 * toute entrée invalide). Côté front, elles servent uniquement à donner un
 * retour immédiat et accessible avant l'appel réseau — jamais de confiance
 * accordée au client. Garder ces contraintes synchronisées avec l'API.
 */

/** Longueur minimale d'un mot de passe (alignée sur `RegisterDto.@MinLength(12)`). */
export const PASSWORD_MIN_LENGTH = 12;
/** Longueur maximale d'un mot de passe (alignée sur `RegisterDto.@MaxLength(128)`). */
export const PASSWORD_MAX_LENGTH = 128;
/** Longueur maximale d'un email (alignée sur `@MaxLength(254)`, RFC 5321). */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Vérifie qu'une adresse email est plausible avant l'envoi.
 * Volontairement permissif (l'API tranche via `@IsEmail`) : on écarte seulement
 * les saisies manifestement incomplètes pour un message immédiat (C7).
 * @param email Valeur brute du champ email.
 * @returns Message d'erreur en français, ou `null` si l'email est valide.
 */
export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (value.length === 0) return 'Veuillez saisir votre adresse email.';
  if (value.length > EMAIL_MAX_LENGTH) return 'Adresse email trop longue.';
  // Format minimal : un « @ » entouré de caractères, un point dans le domaine.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'Adresse email invalide (format attendu : nom@domaine.fr).';
  }
  return null;
}

/**
 * Vérifie la robustesse d'un mot de passe à l'inscription.
 * Reproduit la politique OWASP du serveur : longueur + minuscule, majuscule,
 * chiffre et caractère spécial.
 * @param password Mot de passe en clair saisi par l'utilisateur.
 * @returns Message d'erreur en français, ou `null` si le mot de passe est conforme.
 */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Le mot de passe ne doit pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`;
  }
  if (!/[a-z]/.test(password)) return 'Ajoutez au moins une lettre minuscule.';
  if (!/[A-Z]/.test(password)) return 'Ajoutez au moins une lettre majuscule.';
  if (!/\d/.test(password)) return 'Ajoutez au moins un chiffre.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Ajoutez au moins un caractère spécial (!, ?, @…).';
  return null;
}

/**
 * Message d'aide décrivant la politique de mot de passe, affiché sous le champ
 * d'inscription (C7 : l'exigence est annoncée avant la saisie, pas seulement
 * en erreur).
 */
export const PASSWORD_HINT = `Au moins ${PASSWORD_MIN_LENGTH} caractères, avec majuscule, minuscule, chiffre et caractère spécial.`;
