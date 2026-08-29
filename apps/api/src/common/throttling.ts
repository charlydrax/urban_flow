import { Throttle } from '@nestjs/throttler';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Limitation de débit de l'API Gateway (UF-604 — C4 / OWASP A07 « Identification
 * and Authentication Failures », A04 « Insecure Design »).
 *
 * Les seuils sont regroupés ici, et pas dispersés dans les contrôleurs, parce
 * qu'un plafond de sécurité se relit et se justifie en bloc : c'est la seule
 * façon de vérifier d'un coup d'œil qu'aucun endpoint sensible n'a été oublié.
 *
 * Toutes les fenêtres sont **glissantes** et comptées **par adresse IP** (le
 * `Throttler` de NestJS suit `req.ip`). Conséquence assumée : le compteur du
 * login n'est pas indexé sur l'e-mail visé. Compter par e-mail ouvrirait un
 * déni de service ciblé — n'importe qui pourrait bloquer le compte d'un tiers
 * en enchaînant des tentatives sur son adresse. Le coût, c'est qu'une attaque
 * distribuée sur un large parc d'IP passe sous le radar ; c'est le compromis
 * standard, et l'argon2 du `AuthService` reste la seconde ligne de défense.
 */

/** Une minute — fenêtre de référence de tous les compteurs (en millisecondes). */
const ONE_MINUTE_MS = 60_000;

/**
 * Plafond global appliqué à **tous** les endpoints par le guard global.
 *
 * 120 requêtes/minute et par IP : très au-dessus d'un usage humain normal (un
 * écran de planification déclenche une poignée d'appels), assez bas pour
 * qu'un script de moissonnage ou une boucle de retry emballée soit coupé.
 * Ce plafond n'est pas là contre le brute-force — c'est le rôle des seuils
 * ci-dessous —, il est là contre l'abus généralisé (OWASP A04).
 */
export const GLOBAL_THROTTLE = { name: 'default', ttl: ONE_MINUTE_MS, limit: 120 } as const;

/**
 * Plafond des endpoints d'authentification (`POST /auth/login`, `POST /auth/register`).
 *
 * 5 tentatives par minute et par IP. C'est la recette 2 du ticket : au-delà,
 * l'API répond 429 sans même consulter la base. Un attaquant qui teste un
 * dictionnaire passe de plusieurs milliers d'essais par minute à cinq — un
 * mot de passe à 8 caractères aléatoires devient hors de portée en pratique.
 *
 * Pourquoi si bas côté utilisateur légitime : cinq erreurs de saisie dans la
 * même minute n'arrivent pas, et la sanction expire toute seule au bout d'une
 * minute (pas de verrouillage de compte, donc pas de déni de service possible
 * sur un compte tiers).
 *
 * `register` est logé à la même enseigne : sans plafond, l'inscription est un
 * générateur de comptes en masse, et un oracle d'énumération (le 409 « email
 * déjà utilisé » dit qui possède un compte).
 */
export const AUTH_THROTTLE_LIMIT = 5;

/**
 * Plafond du planificateur (`POST /routes/plan`).
 *
 * 20 calculs par minute et par IP. Chaque appel déclenche trois requêtes
 * sortantes (OTP, GBFS, PostGIS) : sans plafond, l'endpoint le plus coûteux du
 * système est aussi une arme d'amplification contre **nos fournisseurs de
 * données**, dont les quotas sont partagés par tous nos utilisateurs. Le
 * plafond protège donc autant nos partenaires que notre disponibilité
 * (C5 — éco-conception : on ne relaie pas des rafales inutiles).
 */
export const PLAN_THROTTLE_LIMIT = 20;

/**
 * Options du `ThrottlerModule` racine.
 *
 * Le stockage est celui par défaut : **en mémoire du processus**. Suffisant
 * pour le MVP mono-instance ; à remplacer par le stockage Redis
 * (`@nest-lab/throttler-storage-redis`) le jour où l'API tourne en plusieurs
 * répliques, sinon chaque réplique compte de son côté et le plafond effectif
 * est multiplié par le nombre d'instances. Noté dans `docs/securite-owasp.md`.
 */
export const THROTTLER_OPTIONS: ThrottlerModuleOptions = {
  throttlers: [GLOBAL_THROTTLE],
  // Message générique : il ne dit ni quel compte est visé, ni combien de
  // tentatives restent — un compteur affiché aiderait surtout l'attaquant (C4).
  errorMessage: 'Too many requests - please retry in a moment.',
};

/**
 * Décorateur des endpoints d'authentification — brute-force (recette 2 d'UF-604).
 * @see AUTH_THROTTLE_LIMIT pour la justification du seuil
 */
export const ThrottleAuth = (): MethodDecorator & ClassDecorator =>
  Throttle({ default: { ttl: ONE_MINUTE_MS, limit: AUTH_THROTTLE_LIMIT } });

/**
 * Décorateur du planificateur d'itinéraires — abus de l'endpoint coûteux.
 * @see PLAN_THROTTLE_LIMIT pour la justification du seuil
 */
export const ThrottlePlan = (): MethodDecorator & ClassDecorator =>
  Throttle({ default: { ttl: ONE_MINUTE_MS, limit: PLAN_THROTTLE_LIMIT } });
