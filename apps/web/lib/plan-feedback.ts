import type {
  AppliedRouteConstraints,
  RouteSourceName,
  SourceAvailability,
} from '@urbanflow/shared';

import { ApiError } from './api-client';

/**
 * Ce que l'écran de résultats **dit** quand la recherche ne se passe pas comme
 * prévu (UF-405) — cas non nominaux du diagramme de séquence.
 *
 * Module **pur** : il ne connaît ni React ni le routeur, il transforme une
 * erreur ou un état de sources en texte à afficher. C'est ce qui le rend
 * testable dans l'environnement `node` de Vitest, où les tests de composants
 * (jsdom) n'existent pas encore — même stratégie que `itinerary-cards.ts`.
 *
 * ## Les quatre situations, et pourquoi elles ne se disent pas pareil
 *
 * | Situation                      | Ce que l'usager doit comprendre                  |
 * | ------------------------------ | ------------------------------------------------ |
 * | Aucun trajet trouvé            | La recherche a marché ; il n'y a rien à proposer |
 * | Aucune source n'a répondu      | La recherche n'a pas pu aboutir ; réessayer      |
 * | Une source manque sur trois    | Les résultats sont exploitables mais incomplets  |
 * | Session expirée                | Rien n'est cassé ; il faut se reconnecter        |
 * | Connexion perdue (UF-601)      | L'appareil est hors-ligne ; rien à réessayer     |
 *
 * Les confondre, c'est envoyer quelqu'un vérifier sa connexion alors que son
 * trajet n'existe pas, ou lui faire croire que l'application est en panne alors
 * qu'il vient simplement de rester une heure sur l'onglet (C10).
 *
 * Couvre : C7 (messages explicites, ton `alert` réservé aux vraies pannes —
 * WCAG 3.3.1 / 4.1.3), C10 (dégradation gracieuse annoncée sans bloquer),
 * C11 (aucun statut HTTP ni détail serveur dans le texte affiché).
 */

/**
 * Nature d'un échec de `POST /routes/plan`, du point de vue de l'écran.
 *
 * Volontairement plus grossier que le statut HTTP : ce qui compte n'est pas
 * « 502 plutôt que 504 » mais « que doit faire l'usager maintenant ». Le détail
 * technique reste dans les logs du serveur (C11).
 */
export type PlanFailureKind =
  /** 401 — le guard JWT a rejeté le token (absent, falsifié, expiré). */
  | 'session-expired'
  /** 400 — la requête elle-même est refusée (extrémité sans coordonnées). */
  | 'invalid-request'
  /**
   * 404 — l'API dit explicitement « aucun trajet ».
   *
   * Notre API ne le renvoie pas : depuis UF-402, une recherche sans solution
   * est un `200` avec une liste vide **et** l'état des sources, parce que « rien
   * à proposer » et « personne n'a répondu » ne s'affichent pas pareil et qu'un
   * corps d'erreur 404 ne transporterait pas cette nuance. Le cas est traité
   * quand même : le diagramme de séquence prévoit cette branche, et un
   * intermédiaire réseau (proxy, mauvaise `NEXT_PUBLIC_API_URL`) peut la
   * produire sans que l'API en sache rien. Elle se replie alors sur le message
   * « aucun trajet », jamais sur une erreur rouge.
   */
  | 'no-route'
  /**
   * L'appareil n'a plus de réseau, et le service worker n'avait aucun
   * itinéraire en cache à servir (UF-601).
   *
   * Distinct de `unavailable`, qui accuse implicitement nos serveurs et
   * demande de « vérifier votre connexion » : ici la connexion est déjà connue
   * pour absente, l'inviter à la vérifier est un contresens, et il n'y a rien à
   * relancer avant le retour du réseau.
   */
  | 'offline'
  /** Tout le reste : 5xx, réponse illisible, réseau défaillant sans être coupé. */
  | 'unavailable';

/** Ce que l'appelant sait du réseau au moment où il classe l'échec. */
export interface PlanFailureContext {
  /**
   * État de la connexion vu par le navigateur (`navigator.onLine`).
   *
   * Passé en paramètre et non lu ici : `plan-feedback.ts` est un module pur,
   * testé sans DOM. `true` par défaut — sans information, on suppose le réseau
   * présent, ce qui conserve le comportement d'avant UF-601.
   */
  online?: boolean;
}

/**
 * Range l'erreur levée par `apiClient.planRoutes` dans une des cases ci-dessus.
 *
 * Les erreurs qui viennent de **notre contrat** (401, 400, 404) sont classées
 * telles quelles, même hors-ligne : ce sont des réponses lues, pas des
 * suppositions, et elles gardent leur sens. Seul le fourre-tout `unavailable`
 * bascule en `offline` quand le navigateur se sait déconnecté — y compris le
 * `503` que le service worker fabrique lui-même faute d'itinéraire en cache.
 *
 * @param error Ce que la promesse a rejeté — jamais supposé être une `ApiError`
 * @param context Ce qu'on sait du réseau ; voir {@link PlanFailureContext}
 * @returns La nature de l'échec ; `unavailable` par défaut, faute de mieux
 */
export function classifyPlanFailure(
  error: unknown,
  context: PlanFailureContext = {},
): PlanFailureKind {
  const fallback = context.online === false ? 'offline' : 'unavailable';
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 401) return 'session-expired';
  if (error.status === 400) return 'invalid-request';
  if (error.status === 404) return 'no-route';
  return fallback;
}

/** Un message d'écran, avec le rôle ARIA qui va avec. */
export interface PlanNotice {
  /**
   * `alert` interrompt la lecture en cours, `status` attend une pause.
   *
   * Réserver `alert` aux vraies pannes n'est pas une politesse : un lecteur
   * d'écran qui coupe la parole à chaque résultat vide devient inutilisable
   * (C7 — WCAG 4.1.3).
   */
  role: 'alert' | 'status';
  message: string;
}

/**
 * Ce qui s'affiche pour chaque échec, en français, sans jargon ni statut HTTP.
 *
 * `no-route` n'y figure pas : ce n'est pas une panne mais un résultat, et son
 * texte vient de {@link describeEmptyResult} — le seul qui sache aussi dire
 * *pourquoi* la liste est vide.
 *
 * La session expirée est en `status` et non en `alert` : la redirection vers
 * `/login` est déjà lancée quand le message paraît (UF-106), et couper la
 * parole à un lecteur d'écran une demi-seconde avant de changer de page ne lui
 * apprendrait rien — le message sert à expliquer la redirection, pas à alerter.
 */
export const PLAN_FAILURE_NOTICES: Record<Exclude<PlanFailureKind, 'no-route'>, PlanNotice> = {
  'session-expired': {
    role: 'status',
    message:
      'Votre session a expiré. Vous allez être redirigé vers la page de connexion pour relancer votre recherche.',
  },
  'invalid-request': {
    role: 'alert',
    message:
      'Les points de départ et d’arrivée doivent être choisis dans la liste de suggestions, pour que nous connaissions leur position exacte.',
  },
  offline: {
    role: 'status',
    message:
      'Vous êtes hors connexion et aucun itinéraire récent n’est enregistré sur cet appareil. Votre recherche sera possible dès le retour du réseau.',
  },
  unavailable: {
    role: 'alert',
    message:
      'Le calcul d’itinéraires n’a pas abouti. Vérifiez votre connexion, puis relancez la recherche.',
  },
};

/**
 * Note affichée quand le service worker a servi le **dernier itinéraire
 * mémorisé** à la place d'un calcul (UF-601, étape 22 du flux de référence).
 *
 * Ton `warning` et non `error` : l'écran est utilisable, les itinéraires sont
 * réels — ils répondent seulement à la recherche *précédente*. C'est exactement
 * la nuance du mode dégradé des sources, et elle mérite le même traitement.
 *
 * Le message dit explicitement « recherche précédente » : sans cela, quelqu'un
 * qui vient de saisir deux adresses dans un tunnel croirait lire le trajet
 * qu'il vient de demander, et descendrait au mauvais arrêt.
 */
export const CACHED_ROUTE_NOTICE: PlanNotice = {
  role: 'status',
  message:
    'Affichage hors-ligne : voici le dernier itinéraire calculé lors de votre recherche précédente, pas le résultat de celle-ci.',
};

/**
 * Note affichée à un visiteur **non connecté** sur le planificateur (UF-801).
 *
 * Ton `info` et rôle `status` : rien n'est cassé, rien n'est refusé. C'est le
 * pendant exact de la note « filtre PMR actif » — elle relie ce qui est à
 * l'écran à un état du compte, pour qu'une absence ne se lise pas comme une
 * panne.
 *
 * ## Ce que le message dit, et pourquoi il le dit ainsi
 *
 * Il annonce ce qui **manque** (l'historique, le bilan carbone) et non ce qui
 * est permis : le visiteur voit déjà que la recherche fonctionne, il n'a pas
 * besoin qu'on le lui confirme. Ce qu'il ne peut pas deviner, c'est que ses
 * trajets ne sont conservés nulle part — et il vaut mieux qu'il l'apprenne
 * avant de compter dessus qu'en revenant le lendemain.
 *
 * Formulé comme une information, jamais comme un péage : le planificateur
 * fonctionne entièrement sans compte, et un bandeau qui laisserait entendre le
 * contraire pousserait à créer un compte pour un service déjà rendu — une
 * collecte de données obtenue par malentendu (C8).
 *
 * L'invitation à se connecter n'est pas dans ce texte : c'est un **lien**, posé
 * par l'écran sous le message. Une phrase « connectez-vous » sans cible
 * obligerait à repartir chercher le bouton dans l'en-tête (C7 — WCAG 2.4.4).
 */
export const GUEST_MODE_NOTICE: PlanNotice = {
  role: 'status',
  message:
    'Vous utilisez UrbanFlow sans compte : vos recherches ne sont pas conservées et votre bilan carbone n’est pas suivi.',
};

/**
 * Nom lisible de chacune des trois sources (UF-305).
 *
 * « Transports en commun » et non « GTFS » : le bandeau de mode dégradé
 * s'adresse à un usager, pas à un intégrateur. Le nom technique reste dans les
 * logs et dans le contrat d'API.
 */
export const SOURCE_LABELS: Record<RouteSourceName, string> = {
  transit: 'transports en commun',
  sharedMobility: 'vélos et trottinettes en libre-service',
  cyclePaths: 'pistes cyclables',
};

/**
 * Dit pourquoi la liste d'itinéraires est vide.
 *
 * Deux causes très différentes se cachent derrière la même liste vide, et
 * `sources` est la seule chose qui permette de les distinguer :
 *
 * - **aucune source n'a répondu** — la recherche n'a pas pu aboutir, il y a
 *   quelque chose à réessayer. Ton `alert`.
 * - **les sources ont répondu, sans rien à proposer** — la recherche a marché,
 *   il n'y a simplement pas de trajet. Ton `status` : inviter à vérifier sa
 *   connexion serait un contresens.
 *
 * Depuis UF-602, une **troisième** cause s'intercale entre les deux : le profil
 * a pu écarter tout ce que les sources proposaient. Elle passe avant le message
 * neutre, parce qu'elle est la seule sur laquelle l'usager ait prise —
 * « essayez une adresse plus proche d'un axe desservi » est un mauvais conseil
 * quand le réseau desservait bien le trajet, mais pas en fauteuil roulant.
 *
 * @param sources État des sources publié par l'API pour cette recherche ; un
 * tableau vide (cas d'un 404 renvoyé par un intermédiaire) est traité comme
 * « pas d'information » et rend le message neutre
 * @param constraints Contraintes du profil appliquées à cette recherche ;
 * absentes d'une réponse mise en cache avant UF-602, auquel cas le message
 * revient à sa formulation d'origine
 * @returns Le message à afficher — jamais `null` : une liste vide se commente
 * toujours, sinon l'écran ne fait que ne rien afficher
 */
export function describeEmptyResult(
  sources: readonly SourceAvailability[],
  constraints?: AppliedRouteConstraints | null,
): PlanNotice {
  if (sources.length > 0 && sources.every((source) => !source.available)) {
    return {
      role: 'alert',
      message:
        'Aucune de nos sources de mobilité n’a répondu pour cette recherche. Réessayez dans un instant.',
    };
  }

  // Les sources ont parlé, et c'est le filtre qui a tout retiré : le dire est
  // la seule façon d'éviter que l'usager conclue « ce trajet n'existe pas »
  // alors qu'il existe, mais pas sous la contrainte qu'il a lui-même posée
  // (C7 — WCAG 3.3.1, C12).
  if (constraints?.reducedMobility) {
    return {
      role: 'status',
      message:
        'Aucun itinéraire praticable en fauteuil roulant entre ces deux points. D’autres trajets existent peut-être : décochez « Itinéraires accessibles PMR » dans votre profil pour les voir.',
    };
  }

  return {
    role: 'status',
    message:
      'Aucun trajet disponible entre ces deux points pour l’instant. Essayez une adresse plus proche d’un axe desservi.',
  };
}

/**
 * Dit que le profil a **restreint** la liste affichée (UF-602 — C7/C12).
 *
 * ## Pourquoi ce message existe
 *
 * Le filtre PMR est appliqué en deux endroits invisibles à l'écran : la requête
 * envoyée à OpenTripPlanner porte `wheelchair: true`, puis la fusion écarte tout
 * candidat non accessible. L'usager ne voit que le résultat — trois options au
 * lieu de cinq — sans rien qui le relie à la case qu'il a cochée, peut-être des
 * semaines plus tôt, sur une autre page. C'est le même défaut que d'afficher
 * une liste filtrée sans montrer le filtre actif.
 *
 * ## Pourquoi il n'est pas un avertissement
 *
 * Ton `info` et rôle `status` : la contrainte fait exactement ce qu'on lui
 * demande, il n'y a **rien à corriger**. Le peindre en orange ferait chercher
 * un problème dans un réglage volontaire, et suggérerait de le retirer — ce qui
 * n'est pas notre rôle.
 *
 * Rend `null` quand aucune contrainte n'est active : un bandeau permanent
 * « aucun filtre » finirait par ne plus être lu, et rendrait le vrai message
 * invisible le jour où il paraît.
 *
 * @param constraints Contraintes publiées par l'API pour cette recherche
 * @returns Le message à afficher, ou `null` s'il n'y a rien à signaler
 */
export function describeAppliedConstraints(
  constraints: AppliedRouteConstraints | null | undefined,
): PlanNotice | null {
  if (!constraints?.reducedMobility) return null;

  return {
    role: 'status',
    message:
      'Filtre accessibilité actif : seuls les itinéraires praticables en fauteuil roulant vous sont proposés. Modifiable dans votre profil de mobilité.',
  };
}

/** Le bandeau discret « mode dégradé » et ce qui manque pour l'écrire. */
export interface DegradedSourcesNotice {
  /** Phrase affichée, déjà accordée au nombre de sources absentes. */
  message: string;
  /** Sources absentes, dans l'ordre publié par l'API — pour le détail replié. */
  missing: RouteSourceName[];
}

/**
 * Compose la note « certaines options peuvent manquer » (C10).
 *
 * Rend `null` dans deux cas, et il faut les deux :
 *
 * - **aucune source en échec** — il n'y a rien à signaler, et un bandeau
 *   permanent « tout va bien » finit par ne plus être lu ;
 * - **toutes les sources en échec** — ce n'est plus un mode dégradé mais une
 *   panne franche, déjà dite par {@link describeEmptyResult}. Afficher les deux
 *   ferait lire deux fois la même chose, dont une en la minimisant.
 *
 * Le bandeau ne dit **pas** pourquoi la source est absente : `reason`
 * (`timeout`, `upstream-error`…) renseigne l'exploitation, pas l'usager, et
 * l'afficher exposerait notre topologie (C11).
 *
 * @param sources État des sources publié par l'API pour cette recherche
 * @returns La note à afficher, ou `null` s'il n'y a rien à signaler
 */
export function describeDegradedSources(
  sources: readonly SourceAvailability[],
): DegradedSourcesNotice | null {
  const missing = sources.filter((source) => !source.available).map((source) => source.source);
  if (missing.length === 0 || missing.length === sources.length) return null;

  const labels = missing.map((source) => SOURCE_LABELS[source]);
  const list =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} et ${labels.at(-1)}`;

  return {
    message: `Certaines options peuvent manquer : nos données ${list} sont momentanément indisponibles.`,
    missing,
  };
}
