import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SharedMobilityUnavailableReason } from '@urbanflow/shared';

import type {
  GbfsDiscoveryData,
  GbfsFeed,
  GbfsFeedDescriptor,
  GbfsStationInformation,
  GbfsStationInformationData,
  GbfsStationStatus,
  GbfsStationStatusData,
  GbfsVehicleType,
  GbfsVehicleTypesData,
} from './gbfs.types';

/**
 * Panne du flux de mobilité partagée, qualifiée par sa cause.
 *
 * Le connecteur la rattrape et la traduit en `status: 'unavailable'` : elle ne
 * remonte donc jamais jusqu'au contrôleur (dégradation gracieuse — C10).
 */
export class GbfsUnavailableError extends Error {
  constructor(
    readonly reason: SharedMobilityUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = 'GbfsUnavailableError';
  }
}

/**
 * Durée de validité des flux quasi statiques : auto-découverte, description des
 * stations, catalogue des véhicules.
 *
 * Une station change de nom ou de capacité quelques fois par an, et l'opérateur
 * annonce lui-même un `ttl` d'une heure sur ces flux. Les relire à chaque
 * recherche serait trois requêtes réseau gratuites (C5).
 */
const STATIC_FEED_TTL_MS = 60 * 60 * 1000;

/** Noms normalisés des flux consommés (vocabulaire de la spécification GBFS). */
const FEED_STATION_INFORMATION = 'station_information';
const FEED_STATION_STATUS = 'station_status';
const FEED_VEHICLE_TYPES = 'vehicle_types';

/** Clé de cache du document d'auto-découverte. */
const DISCOVERY_KEY = 'gbfs.json';

/** Entrée du cache : la *promesse* est stockée, pas seulement sa valeur. */
interface CacheEntry {
  expiresAt: number;
  value: Promise<unknown>;
}

/**
 * Client bas niveau des flux GBFS d'un opérateur de mobilité partagée (UF-303).
 *
 * Sa seule responsabilité est l'acheminement : découvrir les flux, les lire, les
 * borner dans le temps, les mémoïser, et transformer toute défaillance en
 * `GbfsUnavailableError` qualifiée. Il ne sait rien des stations proches ni des
 * contrats métier — c'est le mapper qui s'en charge.
 *
 * **Auto-découverte** (C9) : les URL des flux ne sont pas écrites en dur, elles
 * sont lues dans `gbfs.json` comme la spécification le prévoit. Brancher un
 * second opérateur ne demandera qu'une URL de plus en configuration, et un
 * opérateur qui réorganise ses chemins ne cassera rien.
 *
 * `fetch` natif plutôt qu'un client HTTP tiers : Node 22 l'expose globalement,
 * et une dépendance de moins, c'est un vecteur de vulnérabilité et quelques
 * kilo-octets d'image en moins (C5). Même choix qu'`OtpClient`.
 *
 * Couvre : F3, C9 (GBFS via son auto-découverte standard), C10 (timeout borné,
 * pannes absorbées), C5 (mémoïsation par flux, selon sa volatilité réelle),
 * C11 (aucune donnée personnelle journalisée — la position de l'usager ne sort
 * jamais d'ici, le flux lu est le même pour tout le monde).
 */
@Injectable()
export class GbfsClient {
  private readonly logger = new Logger(GbfsClient.name);
  private readonly discoveryUrl: string;
  private readonly timeoutMs: number;
  private readonly statusTtlMs: number;

  /**
   * Cache par flux. Il stocke la **promesse** en cours, pas seulement le
   * résultat : dix recherches simultanées après expiration du TTL déclenchent
   * ainsi une seule requête réseau, et non dix (C5).
   */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(config: ConfigService) {
    // `getOrThrow` n'est pas nécessaire : env.validation.ts a déjà refusé le
    // démarrage si ces variables manquent (fail-fast — C4).
    this.discoveryUrl = config.get<string>('GBFS_DISCOVERY_URL', '');
    this.timeoutMs = Number(config.get<string | number>('GBFS_TIMEOUT_MS', 5000));
    this.statusTtlMs = Number(config.get<string | number>('GBFS_STATUS_TTL_MS', 60000));
  }

  /** Document d'auto-découverte interrogé — exposé pour le diagnostic. */
  get endpoint(): string {
    return this.discoveryUrl;
  }

  /** Durée de mémoïsation du statut temps réel, en millisecondes. */
  get statusTtl(): number {
    return this.statusTtlMs;
  }

  /**
   * Description des stations : position, nom, capacité (flux quasi statique).
   *
   * @returns Les stations publiées par l'opérateur
   * @throws {GbfsUnavailableError} flux injoignable, hors délai ou illisible
   */
  async getStationInformation(): Promise<GbfsStationInformation[]> {
    const feed = await this.getFeed<GbfsStationInformationData>(
      FEED_STATION_INFORMATION,
      STATIC_FEED_TTL_MS,
    );
    return feed.data?.stations ?? [];
  }

  /**
   * État temps réel des stations : véhicules et emplacements disponibles.
   *
   * @param refresh Ignore le cache et relit le flux. Réservé au contrôle de
   *   santé : un état lu dans un cache d'une minute reste un état passé.
   * @returns Les états publiés et l'instant de publication du flux
   * @throws {GbfsUnavailableError} flux injoignable, hors délai ou illisible
   */
  async getStationStatus(
    refresh = false,
  ): Promise<{ stations: GbfsStationStatus[]; publishedAt: string | null }> {
    const feed = await this.getFeed<GbfsStationStatusData>(
      FEED_STATION_STATUS,
      this.statusTtlMs,
      refresh,
    );

    return {
      stations: feed.data?.stations ?? [],
      publishedAt: toIsoDate(feed.last_updated),
    };
  }

  /**
   * Catalogue des types de véhicules de la flotte (vélo, trottinette, assistance).
   *
   * Ce flux est **facultatif** dans la spécification : un opérateur à flotte
   * homogène peut légitimement ne pas le publier. Son absence n'est donc pas
   * traitée comme une panne — elle prive seulement la réponse du détail par
   * catégorie, ce que le mapper sait gérer.
   *
   * @returns Les types publiés, ou un tableau vide si le flux n'existe pas
   * @throws {GbfsUnavailableError} si le flux est déclaré mais injoignable
   */
  async getVehicleTypes(): Promise<GbfsVehicleType[]> {
    const feeds = await this.getDiscovery();
    if (!feeds.has(FEED_VEHICLE_TYPES)) {
      return [];
    }

    const feed = await this.getFeed<GbfsVehicleTypesData>(FEED_VEHICLE_TYPES, STATIC_FEED_TTL_MS);
    return feed.data?.vehicle_types ?? [];
  }

  /**
   * Vérifie que l'opérateur publie bien un statut exploitable, pour l'état des
   * sources (C10).
   *
   * Le cache est volontairement contourné : une sonde de santé qui lit une
   * valeur mémoïsée annoncerait un flux « opérationnel » après sa coupure.
   * C'est le seul appel du connecteur dans ce cas, et il n'a lieu que sur
   * demande explicite de diagnostic.
   *
   * @returns Fraîcheur et volume du flux si l'opérateur répond, la cause sinon
   */
  async probe(): Promise<{
    reachable: boolean;
    publishedAt: string | null;
    stationCount: number;
    reason?: SharedMobilityUnavailableReason;
  }> {
    try {
      const status = await this.getStationStatus(true);
      return {
        reachable: true,
        publishedAt: status.publishedAt,
        stationCount: status.stations.length,
      };
    } catch (error) {
      const reason = error instanceof GbfsUnavailableError ? error.reason : 'upstream-error';
      return { reachable: false, publishedAt: null, stationCount: 0, reason };
    }
  }

  /** Résout les URL des flux depuis le document d'auto-découverte, mémoïsées. */
  private getDiscovery(refresh = false): Promise<Map<string, string>> {
    return this.cached(DISCOVERY_KEY, STATIC_FEED_TTL_MS, refresh, async () => {
      const feed = await this.fetchJson<GbfsFeed<GbfsDiscoveryData>>(
        this.discoveryUrl,
        DISCOVERY_KEY,
      );
      const descriptors = extractFeeds(feed.data);

      if (descriptors.length === 0) {
        throw new GbfsUnavailableError(
          'upstream-error',
          "Le document d'auto-découverte GBFS ne déclare aucun flux.",
        );
      }
      return new Map(descriptors.map((descriptor) => [descriptor.name, descriptor.url]));
    });
  }

  /** Lit un flux nommé, en passant par l'auto-découverte puis par le cache. */
  private getFeed<T>(name: string, ttlMs: number, refresh = false): Promise<GbfsFeed<T>> {
    return this.cached(name, ttlMs, refresh, async () => {
      const feeds = await this.getDiscovery(refresh);
      const url = feeds.get(name);

      if (!url) {
        throw new GbfsUnavailableError(
          'upstream-error',
          `Le flux GBFS « ${name} » n'est pas publié par cet opérateur.`,
        );
      }
      return this.fetchJson<GbfsFeed<T>>(url, name);
    });
  }

  /**
   * Mémoïsation à durée de vie, avec dédoublonnage des requêtes concurrentes.
   *
   * Un échec n'est **jamais** mis en cache : sans cela, une coupure d'une
   * seconde condamnerait la source pour toute la durée du TTL, alors que
   * l'opérateur est peut-être déjà revenu.
   */
  private cached<T>(
    key: string,
    ttlMs: number,
    refresh: boolean,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = this.cache.get(key);
    if (!refresh && hit && hit.expiresAt > Date.now()) {
      return hit.value as Promise<T>;
    }

    const value = load();
    this.cache.set(key, { expiresAt: Date.now() + ttlMs, value });

    void value.catch(() => {
      // Purge conditionnelle : une requête plus récente a pu remplacer l'entrée
      // entre-temps, il ne faut pas détruire son résultat.
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });

    return value;
  }

  /**
   * Émet la requête HTTP, la borne dans le temps et rend le JSON.
   *
   * `AbortSignal.timeout` garantit qu'un opérateur qui accepte la connexion puis
   * se tait ne bloque pas la requête utilisateur : sans borne, le
   * `Promise.allSettled` du Service Itinéraire (UF-305) attendrait indéfiniment
   * cette source (C10).
   */
  private async fetchJson<T>(url: string, feedName: string): Promise<T> {
    const started = Date.now();
    let response: Response;

    try {
      response = await fetch(url, {
        // Un flux public ne demande aucune authentification : aucun en-tête
        // d'identification n'est envoyé, et rien de l'usager ne transite (C11).
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw this.toUnavailable(error, feedName, started);
    }

    if (!response.ok) {
      this.logger.warn(`GBFS ${feedName} : HTTP ${response.status} (${Date.now() - started} ms)`);
      throw new GbfsUnavailableError(
        'upstream-error',
        `Le flux GBFS « ${feedName} » a répondu HTTP ${response.status}.`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new GbfsUnavailableError(
        'upstream-error',
        `Réponse illisible (JSON) sur le flux GBFS « ${feedName} ».`,
      );
    }

    // Une page d'erreur HTML servie en 200, ou un corps vide, franchiraient les
    // contrôles précédents : le contenu est vérifié, pas seulement le statut.
    if (payload === null || typeof payload !== 'object') {
      throw new GbfsUnavailableError(
        'upstream-error',
        `Le flux GBFS « ${feedName} » n'a pas renvoyé d'objet JSON.`,
      );
    }

    this.logger.debug(`GBFS ${feedName} : ${Date.now() - started} ms`);
    return payload as T;
  }

  /** Traduit l'échec de `fetch` en cause exploitable par le mode dégradé (C10). */
  private toUnavailable(error: unknown, feedName: string, started: number): GbfsUnavailableError {
    // `AbortSignal.timeout` rejette avec un DOMException nommé `TimeoutError` ;
    // un `abort()` manuel donnerait `AbortError`. Les deux signifient « trop long ».
    const name = error instanceof Error ? error.name : '';
    const isTimeout = name === 'TimeoutError' || name === 'AbortError';

    // Le message système est journalisé, jamais la position de l'usager : un log
    // ne doit contenir aucune donnée de déplacement (C11).
    this.logger.warn(
      `GBFS ${feedName} indisponible (${isTimeout ? 'timeout' : 'network'}) après ` +
        `${Date.now() - started} ms : ${error instanceof Error ? error.message : String(error)}`,
    );

    return isTimeout
      ? new GbfsUnavailableError(
          'timeout',
          `Le flux GBFS « ${feedName} » n'a pas répondu en moins de ${this.timeoutMs} ms.`,
        )
      : new GbfsUnavailableError('network', `Le flux GBFS « ${feedName} » est injoignable.`);
  }
}

/**
 * Extrait la liste des flux du document d'auto-découverte, quelle que soit sa version.
 *
 * GBFS 3.x place `feeds` directement sous `data` ; GBFS 2.x l'indexe par code
 * langue. Dans ce second cas, la première langue publiée est retenue : les URL
 * y sont identiques d'une langue à l'autre, seuls les libellés de
 * `system_information` diffèrent — et ce flux-là n'est pas consommé ici.
 */
function extractFeeds(data: GbfsDiscoveryData | undefined): GbfsFeedDescriptor[] {
  if (!data || typeof data !== 'object') return [];

  if ('feeds' in data && Array.isArray(data.feeds)) {
    return data.feeds;
  }

  for (const entry of Object.values(data)) {
    if (entry && Array.isArray(entry.feeds)) return entry.feeds;
  }
  return [];
}

/** Convertit des secondes epoch GBFS en chaîne ISO 8601, `null` si absent ou absurde. */
function toIsoDate(seconds: number | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}
