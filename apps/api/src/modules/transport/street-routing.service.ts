import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransportMode, type LineStringGeometry } from '@urbanflow/shared';

import { OtpClient } from './otp/otp.client';
import { decodePolyline } from './otp/otp.mapper';

/** Point géographique WGS84 — le strict nécessaire pour interroger le routeur. */
export interface StreetPoint {
  lat: number;
  lng: number;
}

/** Un cheminement à obtenir : un mode de rue, deux extrémités, une exigence PMR. */
export interface StreetPathQuery {
  /** Mode du segment. Seuls les modes « de rue » ont un profil (voir {@link OTP_STREET_MODES}). */
  mode: TransportMode;
  from: StreetPoint;
  to: StreetPoint;
  /** Exiger un cheminement praticable en fauteuil roulant (C12). */
  wheelchair: boolean;
}

/**
 * Profil de routage OpenTripPlanner par mode interne.
 *
 * Table **exhaustive** et non partielle : ajouter un mode à l'énumération
 * partagée doit casser la compilation ici, pas passer inaperçu et produire
 * silencieusement une ligne droite. `null` signifie « ce mode ne se route pas
 * sur la voirie » — un métro suit sa ligne, pas les rues, et son tracé vient
 * déjà du GTFS (`shapes.txt`) via le connecteur TC.
 *
 * La trottinette emprunte le profil cyclable : c'est le réseau qu'elle utilise
 * réellement (pistes et bandes cyclables), et OTP n'a pas de profil dédié.
 */
export const OTP_STREET_MODES: Record<TransportMode, 'WALK' | 'BICYCLE' | null> = {
  [TransportMode.WALK]: 'WALK',
  [TransportMode.BIKE]: 'BICYCLE',
  [TransportMode.SCOOTER]: 'BICYCLE',
  [TransportMode.BUS]: null,
  [TransportMode.TRAM]: null,
  [TransportMode.METRO]: null,
  [TransportMode.CARPOOL]: null,
};

/**
 * Requête de cheminement sur la voirie.
 *
 * Ni date ni heure : un trottoir et une piste cyclable sont les mêmes à 8 h et
 * à 22 h, et OTP part de « maintenant » par défaut. Ne pas les envoyer garde
 * aussi la requête indépendante de la période couverte par le GTFS — un graphe
 * dont le calendrier a expiré route encore parfaitement les piétons.
 *
 * Le jeu de champs se limite à la polyligne : c'est tout ce que le ticket
 * consomme. Demander les distances, les arrêts ou les horaires ferait payer du
 * calcul et des octets pour des valeurs que personne ne lirait (C5).
 */
const STREET_PATH_QUERY = `
query StreetPath(
  $from: InputCoordinates!
  $to: InputCoordinates!
  $mode: Mode!
  $wheelchair: Boolean!
) {
  plan(
    from: $from
    to: $to
    numItineraries: 1
    wheelchair: $wheelchair
    transportModes: [{ mode: $mode }]
  ) {
    itineraries {
      legs {
        legGeometry { points }
      }
    }
  }
}`;

/** Forme minimale de la réponse — un sous-ensemble strict de `OtpPlanData`. */
interface OtpStreetPlanData {
  plan?: {
    itineraries?: ({
      legs?: ({ legGeometry?: { points?: string | null } | null } | null)[];
    } | null)[];
  } | null;
}

/**
 * Précision, en décimales de degré, de l'arrondi appliqué à la clé de cache.
 *
 * Cinq décimales valent environ un mètre à nos latitudes : deux recherches qui
 * partent de la même borne Vélo'v tombent sur la même clé, alors que deux rues
 * différentes n'y tomberont jamais. Arrondir plus grossièrement ferait servir
 * le cheminement du carrefour voisin ; ne pas arrondir du tout ferait manquer
 * le cache à chaque flottant recalculé.
 */
const CACHE_PRECISION = 5;

/**
 * Durée de validité d'un cheminement en cache.
 *
 * Une heure, comme la période de service du graphe : le réseau piéton et
 * cyclable ne bouge qu'à la reconstruction du graphe, mais garder une entrée
 * indéfiniment ferait survivre un tracé à un `make otp-rebuild` — et personne
 * ne penserait à vider un cache invisible.
 */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Nombre maximal de cheminements mémoïsés.
 *
 * Le cache est une optimisation, pas un magasin : au-delà, il est vidé en bloc
 * plutôt qu'entretenu. Une éviction LRU coûterait plus de code qu'elle
 * n'économiserait d'appels sur un plafond aussi haut, et une carte qui grossit
 * sans borne dans un processus long est une fuite mémoire qui attend son jour.
 */
const CACHE_MAX_ENTRIES = 500;

/**
 * Budget total accordé à une **rafale** de cheminements, en millisecondes.
 *
 * Il ne remplace pas le délai propre du client OTP (`OTP_TIMEOUT_MS`) : il le
 * plafonne. Ces requêtes s'ajoutent à la latence déjà payée par la collecte des
 * trois sources, alors qu'elles n'apportent que du confort visuel — un tracé
 * plus juste. Il n'est donc pas question qu'elles allongent notablement la
 * réponse : passé le budget, on garde les droites et on rend la main (C10 —
 * « aucune régression sur les temps d'affichage », recette du ticket).
 *
 * Deux secondes : un `plan` piéton sur un graphe chargé se répond en quelques
 * dizaines de millisecondes ; dépasser deux secondes signifie que le moteur est
 * en difficulté, pas qu'il faut l'attendre davantage.
 */
const BATCH_BUDGET_MS = 2000;

/** Sentinelle interne : la rafale a dépassé son budget avant d'obtenir ce tracé. */
const BUDGET_EXCEEDED = Symbol('street-path-budget-exceeded');

/** Sentinelle interne : le moteur n'a pas répondu — panne, délai, réseau. */
const ENGINE_SILENT = Symbol('street-path-engine-silent');

/**
 * Durée pendant laquelle on cesse d'interroger un moteur qui vient de se taire
 * sur **toute** une rafale, en millisecondes.
 *
 * ## Pourquoi un coupe-circuit ici, et plus dans l'appelant
 *
 * Jusqu'à ce ticket, le Service Itinéraire décidait à la place de ce service :
 * il ne l'appelait que si la source TC venait de répondre, au motif que les
 * deux parlent au même OpenTripPlanner. Le raccourci a un angle mort — un
 * `plan` TC est un calcul lourd qui peut expirer sur un moteur parfaitement
 * vivant, alors qu'un cheminement piéton se rend en quelques dizaines de
 * millisecondes. Le tracé de la marche et du vélo était alors perdu **parce
 * que le calcul des transports en commun avait été lent**, ce qui donnait des
 * itinéraires tantôt routés, tantôt à vol d'oiseau, sans que rien dans la
 * requête ne l'explique.
 *
 * La règle est donc rendue à ce service, qui seul observe le moteur sur les
 * requêtes qu'il lui adresse réellement : une rafale intégralement muette
 * ouvre le circuit, et les suivantes rendent la main sans payer le budget.
 *
 * ## Pourquoi une minute
 *
 * Assez long pour qu'un moteur arrêté ne coûte qu'une rafale perdue par minute
 * (C5/C10 — la production tourne sans OTP tant que BUG-003 n'est pas déployé),
 * assez court pour qu'un redémarrage soit repris sans intervention ni purge de
 * cache. Une seule rafale de sondage : la première qui suit le délai.
 */
const ENGINE_COOLDOWN_MS = 60 * 1000;

/**
 * Clé d'identité d'un cheminement — mode, extrémités arrondies, exigence PMR.
 *
 * Exportée parce que deux modules en ont besoin sans se connaître : le service
 * la pose sur les résultats, et la fonction pure qui réinjecte les tracés dans
 * les itinéraires (`merge/street-geometry.ts`) doit pouvoir les retrouver. Une
 * clé calculée deux fois de deux manières finirait par diverger.
 */
export function streetPathKey(query: StreetPathQuery): string {
  const round = (value: number) => value.toFixed(CACHE_PRECISION);
  const wheelchair = query.wheelchair ? 'pmr' : 'std';
  return [
    query.mode,
    wheelchair,
    round(query.from.lat),
    round(query.from.lng),
    round(query.to.lat),
    round(query.to.lng),
  ].join(':');
}

/**
 * Routeur de voirie (UF-702) — le cheminement réel d'un segment marche ou vélo.
 *
 * ## Le problème qu'il résout
 *
 * Les segments en transports en commun portent depuis UF-302 la géométrie de
 * tracé du GTFS : un métro épouse sa ligne. Les segments marche et vélo, eux,
 * ne sont pas planifiés par un moteur — la fusion (UF-401) les **synthétise**
 * à partir d'une distance à vol d'oiseau et d'une vitesse. Faute de tracé, ils
 * étaient dessinés en ligne droite, à travers les immeubles et le fleuve.
 *
 * Ce service demande à OpenTripPlanner le cheminement piéton ou cyclable entre
 * les deux extrémités du pas, et rend la polyligne correspondante.
 *
 * ## Pourquoi OTP plutôt qu'un routeur dédié
 *
 * Le ticket laissait le choix entre OTP (mode `WALK`/`BICYCLE`) et un service
 * dédié type OSRM ou Valhalla. OTP est retenu, pour trois raisons :
 *
 * 1. **Il est déjà là.** Le graphe contient le réseau OSM lyonnais
 *    (`docker/otp/data/lyon.osm.pbf`) — celui-là même qui sert à calculer les
 *    rabattements piétons des trajets TC. Le cheminement rendu ici est donc
 *    *exactement* celui qu'emprunte déjà l'itinéraire en transports en commun,
 *    et non celui d'un second réseau qui divergerait du premier.
 * 2. **Une dépendance de moins.** Ajouter OSRM, c'est un conteneur, une image,
 *    un jeu de données à tenir à jour et un point de panne supplémentaires,
 *    pour une capacité que le moteur en place rend déjà (C5).
 * 3. **Une seule panne à gérer.** OTP arrêté, la dégradation est cohérente :
 *    ni trajets TC, ni cheminements routés. Deux moteurs, c'était quatre états
 *    à distinguer et à afficher.
 *
 * Le prix à payer est assumé et visible en production aujourd'hui : sans OTP
 * déployé (BUG-002, puis BUG-003), tous les tracés restent des droites. C'est
 * précisément ce que `geometrySource: 'straight'` sert à dire.
 *
 * ## Contrat de résilience
 *
 * **Ne lève jamais.** Un moteur arrêté, un délai dépassé, une réponse vide :
 * tous donnent l'absence de tracé pour ce cheminement, et l'appelant garde sa
 * ligne droite. Le tracé est un confort ; le perdre ne doit pas coûter un
 * itinéraire (C10).
 *
 * **Décide seul s'il faut interroger le moteur.** Depuis BUG-003, l'appelant
 * n'a plus à savoir si OTP répond : le coupe-circuit de ce service
 * ({@link ENGINE_COOLDOWN_MS}) protège la latence quand le moteur est arrêté,
 * et rend le tracé dès qu'il revient. C'est ce qui garantit qu'un même trajet
 * s'affiche de la même façon d'une recherche à l'autre, pour tout le monde.
 *
 * Couvre : C6 (tracés fidèles au réseau réel), C5 (mémoïsation, jeu de champs
 * minimal, budget borné), C10 (dégradation gracieuse), C11 (les journaux
 * comptent les cheminements, ils ne disent jamais où ils vont), C12 (exigence
 * PMR propagée au cheminement piéton).
 */
@Injectable()
export class StreetRoutingService {
  private readonly logger = new Logger(StreetRoutingService.name);

  /** Cheminements mémoïsés, `null` compris : une absence de chemin est une réponse. */
  private readonly cache = new Map<
    string,
    { geometry: LineStringGeometry | null; fetchedAt: number }
  >();

  /** Budget effectif d'une rafale, borné par le délai propre d'OTP. */
  private readonly budgetMs: number;

  /**
   * Instant (epoch ms) jusqu'auquel le moteur est tenu pour muet.
   *
   * `0` — la valeur de départ — signifie « circuit fermé » : toute date passée
   * laisse partir la rafale suivante. Voir {@link ENGINE_COOLDOWN_MS}.
   */
  private engineSilentUntil = 0;

  constructor(
    private readonly otp: OtpClient,
    config: ConfigService,
  ) {
    // Le budget de la rafale ne dépasse jamais le délai du client : l'attente
    // maximale reste celle qu'OTP s'est vu accorder, jamais davantage.
    const otpTimeoutMs = Number(config.get<string | number>('OTP_TIMEOUT_MS', BATCH_BUDGET_MS));
    this.budgetMs = Math.min(
      BATCH_BUDGET_MS,
      Number.isFinite(otpTimeoutMs) ? otpTimeoutMs : BATCH_BUDGET_MS,
    );
  }

  /**
   * Obtient les cheminements de plusieurs segments, en parallèle et sous budget.
   *
   * Les requêtes **dédupliquées** : la même marche apparaît dans plusieurs
   * itinéraires proposés (la marche d'accès à une borne se retrouve dans le
   * trajet tout-vélo et dans le rabattement), et l'interroger deux fois ferait
   * payer deux allers-retours pour la même réponse (C5).
   *
   * @param queries Cheminements souhaités, dans n'importe quel ordre
   * @returns Les tracés obtenus, indexés par {@link streetPathKey}. Une clé
   *   absente signifie « pas de tracé » — l'appelant garde sa ligne droite.
   */
  async routePaths(queries: readonly StreetPathQuery[]): Promise<Map<string, LineStringGeometry>> {
    const routed = new Map<string, LineStringGeometry>();
    if (queries.length === 0) return routed;

    // Déduplication et lecture du cache en une passe : ne partent sur le réseau
    // que les cheminements qu'on ne connaît pas encore.
    const pending = new Map<string, StreetPathQuery>();
    let hits = 0;

    for (const query of queries) {
      const key = streetPathKey(query);
      if (routed.has(key) || pending.has(key)) continue;

      const cached = this.readCache(key);
      if (cached !== undefined) {
        hits += 1;
        if (cached) routed.set(key, cached);
        continue;
      }

      if (OTP_STREET_MODES[query.mode] === null) continue;
      pending.set(key, query);
    }

    if (pending.size === 0) {
      this.logger.debug(`Cheminements : ${hits} en cache, aucun appel au moteur.`);
      return routed;
    }

    // Coupe-circuit : le moteur s'est tu sur toute une rafale il y a moins
    // d'une minute. On garde les droites sans payer le budget une seconde fois
    // (C10) — et sans que l'appelant ait à savoir pourquoi.
    if (Date.now() < this.engineSilentUntil) {
      this.logger.debug(
        `Cheminements : moteur tenu pour muet encore ` +
          `${Math.ceil((this.engineSilentUntil - Date.now()) / 1000)} s, ` +
          `${pending.size} tracé(s) laissé(s) à vol d'oiseau.`,
      );
      return routed;
    }

    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<typeof BUDGET_EXCEEDED>((resolve) => {
      timer = setTimeout(() => resolve(BUDGET_EXCEEDED), this.budgetMs);
    });

    try {
      // Un seul budget partagé par toute la rafale, et non un par requête : ce
      // qu'on protège, c'est le temps de réponse de l'usager, qui ne se
      // décompose pas en requêtes.
      const settled = await Promise.all(
        [...pending].map(async ([key, query]) => {
          const geometry = await Promise.race([this.fetchPath(query), budget]);
          return { key, geometry };
        }),
      );

      // Compté pour le coupe-circuit : une rafale dont AUCUNE requête n'a été
      // honorée dit quelque chose du moteur, là où un échec isolé ne dit rien.
      let silent = 0;

      for (const { key, geometry } of settled) {
        // `typeof` plutôt qu'une comparaison aux sentinelles : `Promise.race`
        // élargit les symboles uniques en `symbol`, et le compilateur ne
        // rétrécirait pas l'union sur l'égalité.
        if (typeof geometry === 'symbol') {
          // Ni le budget dépassé ni le silence du moteur ne sont mis en cache :
          // la prochaine recherche doit pouvoir retenter, le moteur ayant pu se
          // remettre entre-temps.
          silent += 1;
          continue;
        }
        this.writeCache(key, geometry);
        if (geometry) routed.set(key, geometry);
      }

      this.updateBreaker(silent, pending.size);
    } finally {
      if (timer) clearTimeout(timer);
    }

    // C11 : on compte les cheminements, on ne dit jamais où ils mènent.
    this.logger.log(
      `Cheminements routés : ${routed.size}/${queries.length} obtenus ` +
        `(${hits} en cache, ${pending.size} appel(s) en ${Date.now() - startedAt} ms).`,
    );
    return routed;
  }

  /**
   * Ouvre ou referme le coupe-circuit au vu de la rafale qui vient de finir.
   *
   * Le critère est **l'unanimité**, pas la proportion : un cheminement isolé
   * peut échouer parce qu'il n'existe pas (une extrémité au milieu du Rhône),
   * et en conclure que le moteur est en panne priverait de tracé les segments
   * parfaitement routables des recherches suivantes.
   *
   * @param silent Nombre de requêtes restées sans réponse exploitable
   * @param attempted Nombre de requêtes effectivement parties sur le réseau
   */
  private updateBreaker(silent: number, attempted: number): void {
    if (attempted > 0 && silent === attempted) {
      this.engineSilentUntil = Date.now() + ENGINE_COOLDOWN_MS;
      // `warn` et non `debug` : contrairement à l'échec d'un cheminement isolé,
      // un moteur muet se voit sur la carte de tous les usagers — c'est le
      // symptôme que BUG-003 demande de pouvoir lire dans les journaux. Aucune
      // coordonnée n'y figure (C11).
      this.logger.warn(
        `Moteur de voirie muet sur ${attempted} cheminement(s) : tracés à vol d'oiseau ` +
          `pendant ${ENGINE_COOLDOWN_MS / 1000} s.`,
      );
      return;
    }

    // Une seule réponse suffit à refermer le circuit : le moteur est là.
    this.engineSilentUntil = 0;
  }

  /**
   * Interroge le moteur pour **un** cheminement.
   *
   * @returns Le tracé ; `null` si le moteur a répondu qu'il n'y a pas de chemin
   *   (une réponse, qu'il est légitime de mémoriser) ; {@link ENGINE_SILENT}
   *   s'il n'a pas répondu du tout. Ne lève jamais : voir le contrat de
   *   résilience de la classe.
   */
  private async fetchPath(
    query: StreetPathQuery,
  ): Promise<LineStringGeometry | null | typeof ENGINE_SILENT> {
    const profile = OTP_STREET_MODES[query.mode];
    if (!profile) return null;

    try {
      const data = await this.otp.query<OtpStreetPlanData>(
        STREET_PATH_QUERY,
        {
          from: { lat: query.from.lat, lon: query.from.lng },
          to: { lat: query.to.lat, lon: query.to.lng },
          mode: profile,
          wheelchair: query.wheelchair,
        },
        'streetPath',
      );

      return toStreetGeometry(data);
    } catch (error) {
      // Une panne du moteur n'est pas une panne du planificateur : elle coûte
      // un tracé, pas un itinéraire (C10). Journalisée en `debug` et non en
      // `warn` : la collecte des sources aura déjà signalé la même panne, et la
      // répéter une fois par segment noierait le journal.
      this.logger.debug(
        `Cheminement ${query.mode} indisponible : ${error instanceof Error ? error.message : String(error)}`,
      );
      return ENGINE_SILENT;
    }
  }

  /**
   * Lit le cache.
   * @returns `undefined` si l'entrée est absente ou périmée, sinon sa valeur —
   *   `null` compris, qui signifie « le moteur a répondu qu'il n'y a pas de
   *   chemin », une réponse qu'il serait absurde de redemander à chaque fois.
   */
  private readCache(key: string): LineStringGeometry | null | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.fetchedAt >= CACHE_TTL_MS) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.geometry;
  }

  /** Écrit dans le cache, en le vidant en bloc s'il a atteint son plafond. */
  private writeCache(key: string, geometry: LineStringGeometry | null): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES && !this.cache.has(key)) {
      this.cache.clear();
    }
    this.cache.set(key, { geometry, fetchedAt: Date.now() });
  }
}

/**
 * Extrait la polyligne d'une réponse de cheminement.
 *
 * Les segments de l'itinéraire rendu sont **concaténés** : un cheminement
 * piéton peut être découpé en plusieurs pas par OTP (une traversée, un escalier,
 * une rue piétonne), et n'en garder qu'un donnerait un tracé tronqué.
 *
 * @returns Le tracé, ou `null` s'il n'atteint pas les deux points qu'exige une
 *   `LineString` valide (RFC 7946 — C9).
 */
function toStreetGeometry(data: OtpStreetPlanData): LineStringGeometry | null {
  const legs = data.plan?.itineraries?.[0]?.legs ?? [];
  const coordinates: [number, number][] = [];

  for (const leg of legs) {
    for (const point of decodePolyline(leg?.legGeometry?.points)) {
      const last = coordinates[coordinates.length - 1];
      // Le dernier point d'un pas est le premier du suivant : le publier deux
      // fois n'ajouterait rien au rendu et alourdirait la réponse (C5).
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      coordinates.push(point);
    }
  }

  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
}
