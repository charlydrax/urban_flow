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
 * déployé (BUG-002), tous les tracés restent des droites. C'est précisément ce
 * que `geometrySource: 'straight'` sert à dire.
 *
 * ## Contrat de résilience
 *
 * **Ne lève jamais.** Un moteur arrêté, un délai dépassé, une réponse vide :
 * tous donnent l'absence de tracé pour ce cheminement, et l'appelant garde sa
 * ligne droite. Le tracé est un confort ; le perdre ne doit pas coûter un
 * itinéraire (C10).
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

      for (const { key, geometry } of settled) {
        // `typeof` plutôt qu'une comparaison à la sentinelle : `Promise.race`
        // élargit le symbole unique en `symbol`, et le compilateur ne
        // rétrécirait pas l'union sur l'égalité.
        if (typeof geometry === 'symbol') continue;
        // Le budget dépassé n'est pas mis en cache : la prochaine recherche
        // doit pouvoir retenter, le moteur ayant pu se remettre entre-temps.
        this.writeCache(key, geometry);
        if (geometry) routed.set(key, geometry);
      }
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
   * Interroge le moteur pour **un** cheminement.
   *
   * @returns Le tracé, ou `null` si le moteur n'a rien pu proposer — panne
   *   comprise. Ne lève jamais : voir le contrat de résilience de la classe.
   */
  private async fetchPath(query: StreetPathQuery): Promise<LineStringGeometry | null> {
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
      return null;
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
