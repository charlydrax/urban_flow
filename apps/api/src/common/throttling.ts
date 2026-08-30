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
 * Toutes les fenêtres sont **glissantes** et comptées **par adresse IP** — clé
 * calculée par `throttleTracker` et appliquée par `IpThrottlerGuard` (UF-802),
 * qui regroupe les adresses IPv6 par réseau /64. Conséquence assumée : le compteur du
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
 * 60 calculs par minute et par IP. Chaque appel déclenche trois requêtes
 * sortantes (OTP, GBFS, PostGIS) : sans plafond, l'endpoint le plus coûteux du
 * système est aussi une arme d'amplification contre **nos fournisseurs de
 * données**, dont les quotas sont partagés par tous nos utilisateurs. Le
 * plafond protège donc autant nos partenaires que notre disponibilité
 * (C5 — éco-conception : on ne relaie pas des rafales inutiles).
 *
 * ## Pourquoi 20 → 60 (UF-802)
 *
 * Le seuil de 20 avait été posé quand l'endpoint exigeait un compte : derrière
 * une IP, il y avait en pratique **un** utilisateur connecté, et vingt calculs
 * par minute étaient déjà six fois son usage réel.
 *
 * UF-801 a ouvert l'endpoint aux visiteurs, ce qui change la nature du
 * compteur sans changer sa valeur : une IP publique n'est plus une personne,
 * c'est un **point de sortie partagé**. Le wifi d'un lycée, le réseau d'une
 * entreprise, et surtout le CGNAT des opérateurs mobiles — où des milliers
 * d'abonnés sortent derrière la même IPv4 — se retrouvaient à se disputer
 * vingt calculs. La recette 4 du ticket (« un usage normal n'atteint jamais le
 * plafond ») ne tenait plus : le premier arrivé consommait le quota des autres.
 *
 * 60 tient les deux bouts. Une recherche = **un** appel (le tri, le filtre PMR
 * et le détail d'un itinéraire ne rappellent rien) ; même à un rythme soutenu,
 * une personne dépasse rarement cinq recherches par minute. Le plafond laisse
 * donc coexister une dizaine d'usagers simultanés derrière la même sortie, tout
 * en bornant l'amplification à 180 requêtes sortantes par minute et par IP —
 * loin du volume qui inquiéterait un fournisseur.
 *
 * Le seuil reste **sous le plafond global** (120) : le planificateur ne peut
 * pas devenir le chemin le plus permissif de l'API.
 */
export const PLAN_THROTTLE_LIMIT = 60;

/**
 * Plafond du signalement d'erreurs front (`POST /diagnostics/client-errors`).
 *
 * 10 signalements par minute et par IP. L'endpoint est **ouvert** (UF-607) :
 * sans plafond serré, il devient un robinet à lignes de journal, et noyer les
 * traces est une façon connue d'effacer les siennes (OWASP A09). Dix, c'est
 * plus qu'un usager n'en produit — un écran qui casse émet un signalement, pas
 * une rafale — et assez peu pour qu'un script n'aille nulle part.
 *
 * Le rejet 429 n'a aucun coût pour l'usager : le front ignore déjà le résultat
 * de ce signalement, un envoi perdu ne dégrade pas son écran.
 */
export const CLIENT_ERROR_THROTTLE_LIMIT = 10;

/**
 * Clé de comptage rendue quand l'IP de la requête est illisible.
 *
 * Ne devrait jamais arriver sur une requête HTTP réelle. Si cela se produit
 * malgré tout (socket déjà fermé, test mal monté), toutes ces requêtes tombent
 * dans le **même** compartiment : en cas de doute, on plafonne plus fort, on
 * n'ouvre pas une voie sans compteur (C4 — sécurité par défaut).
 */
export const UNKNOWN_TRACKER = 'unknown';

/**
 * Longueur de préfixe IPv6 retenue comme identité d'un client (bits).
 *
 * /64 est le bloc que les FAI délèguent à **un** abonné : c'est la plus petite
 * unité qui corresponde à quelqu'un, et donc la bonne maille de comptage.
 */
export const IPV6_TRACKED_PREFIX_BITS = 64;

/** Nombre de groupes hexadécimaux d'une adresse IPv6 complète. */
const IPV6_GROUPS = 8;

/** Groupes conservés pour un /64 : 4 × 16 bits. */
const IPV6_PREFIX_GROUPS = IPV6_TRACKED_PREFIX_BITS / 16;

/** Adresse IPv4 encapsulée en IPv6, forme rendue par Node en écoute double pile. */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;

/** Un groupe IPv6 valide : 1 à 4 chiffres hexadécimaux. */
const IPV6_GROUP = /^[0-9a-f]{1,4}$/;

/**
 * Réduit une adresse IPv6 à son préfixe /64, sous forme canonique.
 *
 * @param address Adresse IPv6 en minuscules, éventuellement abrégée par `::`
 * @returns Le préfixe (`2001:db8:1:2::/64`), ou `null` si l'adresse est illisible
 */
function ipv6Prefix(address: string): string | null {
  // `fe80::1%eth0` : l'identifiant de zone ne fait pas partie de l'adresse.
  const plain = address.split('%')[0];
  const halves = plain.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = halves.length === 2 ? IPV6_GROUPS - head.length - tail.length : 0;
  if (missing < 0) return null;

  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (groups.length !== IPV6_GROUPS) return null;
  if (!groups.every((group) => IPV6_GROUP.test(group))) return null;

  // Zéros de tête retirés : `2001:0db8` et `2001:db8` désignent le même réseau,
  // et deux clés distinctes pour un seul abonné doubleraient son quota.
  const prefix = groups
    .slice(0, IPV6_PREFIX_GROUPS)
    .map((group) => parseInt(group, 16).toString(16))
    .join(':');
  return `${prefix}::/${IPV6_TRACKED_PREFIX_BITS}`;
}

/**
 * Calcule la clé de comptage d'une requête à partir de son adresse IP (UF-802).
 *
 * ## Pourquoi l'IP, et pas le compte
 *
 * Depuis qu'UF-801 a ouvert `/routes/plan` aux visiteurs, la majorité des
 * appels n'ont **aucune identité** à opposer : compter par utilisateur
 * laisserait l'accès invité entièrement hors compteur, c'est-à-dire sans
 * plafond du tout — exactement l'inverse du but. L'IP reste la seule identité
 * dont dispose une requête anonyme. Le guard de débit s'exécute d'ailleurs
 * **avant** le guard JWT (voir `AppModule`) : à l'instant où cette clé est
 * calculée, aucun jeton n'a encore été vérifié, et c'est voulu — une rafale
 * doit être coupée avant de coûter une vérification de signature.
 *
 * ## Pourquoi un /64 en IPv6, et pas l'adresse entière
 *
 * En IPv4, une adresse ≈ un point de sortie : la compter telle quelle a du
 * sens. En IPv6, le moindre abonné se voit déléguer un bloc /64, soit
 * 18 milliards de milliards d'adresses, dont il change **gratuitement** à
 * chaque requête (RFC 4941). Compter l'adresse complète offrirait donc un
 * plafond réinitialisable à volonté : le rate limiting ne vaudrait plus rien
 * face à un client IPv6, et l'endpoint public le plus coûteux du système serait
 * en pratique non plafonné (OWASP A04 « Insecure Design »).
 *
 * Regrouper au /64 rend le compteur infranchissable sans changer de réseau, et
 * ne mutualise que ce qui appartient déjà au même abonné.
 *
 * @param ip Adresse IP de la requête, telle qu'Express l'expose (`req.ip`)
 * @returns Une clé stable : l'IPv4 telle quelle, ou le préfixe /64 en IPv6
 */
export function throttleTracker(ip: string | undefined | null): string {
  const address = ip?.trim().toLowerCase();
  if (!address) return UNKNOWN_TRACKER;

  // `::ffff:203.0.113.7` — c'est une IPv4, elle doit compter comme telle,
  // sinon le même client change de compteur selon la pile utilisée.
  const mapped = IPV4_MAPPED.exec(address);
  if (mapped) return mapped[1];

  if (!address.includes(':')) return address;

  // Adresse IPv6 non reconnue : on la garde entière plutôt que de la jeter
  // dans le compartiment commun — mieux vaut un compteur trop fin qu'aucun.
  return ipv6Prefix(address) ?? address;
}

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

/**
 * Décorateur du collecteur d'erreurs front — endpoint ouvert (UF-607).
 * @see CLIENT_ERROR_THROTTLE_LIMIT pour la justification du seuil
 */
export const ThrottleClientErrors = (): MethodDecorator & ClassDecorator =>
  Throttle({ default: { ttl: ONE_MINUTE_MS, limit: CLIENT_ERROR_THROTTLE_LIMIT } });
