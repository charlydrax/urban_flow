import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TransitUnavailableReason } from '@urbanflow/shared';

import type { OtpGraphQlResponse, OtpServiceTimeRangeData } from './otp.types';

/** Période, en secondes epoch, effectivement couverte par le graphe chargé. */
export interface OtpServiceWindow {
  start: number;
  end: number;
}

/**
 * Panne du moteur de routage, qualifiée par sa cause.
 *
 * Le connecteur la rattrape et la traduit en `status: 'unavailable'` : elle ne
 * remonte donc jamais jusqu'au contrôleur (dégradation gracieuse — C10).
 */
export class OtpUnavailableError extends Error {
  constructor(
    readonly reason: TransitUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = 'OtpUnavailableError';
  }
}

/** Durée de validité du cache de la période couverte par le graphe. */
const SERVICE_WINDOW_TTL_MS = 60 * 60 * 1000;

/**
 * Client bas niveau de l'API GraphQL d'OpenTripPlanner (UF-301).
 *
 * Sa seule responsabilité est le transport : émettre la requête, la borner dans
 * le temps, et transformer toute défaillance en `OtpUnavailableError` qualifiée.
 * Il ne connaît ni les itinéraires ni les contrats métier — c'est le mapper qui
 * s'en charge.
 *
 * `fetch` natif est utilisé plutôt qu'un client HTTP tiers : Node 22 l'expose
 * globalement, et une dépendance de moins, c'est un vecteur de vulnérabilité et
 * quelques kilo-octets d'image en moins (C5).
 *
 * Couvre : F3, C9 (API GraphQL standard d'OTP), C10 (timeout borné, pannes
 * absorbées), C11 (aucune donnée personnelle journalisée).
 */
@Injectable()
export class OtpClient {
  private readonly logger = new Logger(OtpClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  /** Mémoïsation de la période couverte : elle ne bouge qu'à la reconstruction du graphe. */
  private serviceWindowCache: { window: OtpServiceWindow; fetchedAt: number } | null = null;

  constructor(config: ConfigService) {
    // `getOrThrow` n'est pas nécessaire : env.validation.ts a déjà refusé le
    // démarrage si ces variables manquent (fail-fast — C4).
    this.baseUrl = config.get<string>('OTP_BASE_URL', 'http://localhost:8080').replace(/\/+$/, '');
    this.timeoutMs = Number(config.get<string | number>('OTP_TIMEOUT_MS', 12000));
  }

  /** URL de l'API GraphQL interrogée — exposée pour le diagnostic (`/transport/status`). */
  get endpoint(): string {
    return `${this.baseUrl}/otp/gtfs/v1`;
  }

  /**
   * Exécute une requête GraphQL et renvoie son bloc `data`.
   *
   * Les paramètres passent par `variables` et **jamais** par concaténation dans
   * le document : une coordonnée ou une date interpolée dans la chaîne ouvrirait
   * une injection GraphQL, exactement comme une requête SQL construite à la main
   * (C4). Le sérialiseur JSON se charge de l'échappement.
   *
   * @param query Document GraphQL paramétré
   * @param variables Valeurs des paramètres du document
   * @param operation Nom court de l'opération, pour les logs
   * @returns Le contenu de `data`
   * @throws {OtpUnavailableError} timeout, moteur injoignable ou réponse inexploitable
   */
  async query<T>(query: string, variables: Record<string, unknown>, operation: string): Promise<T> {
    // AbortSignal.timeout garantit qu'un moteur qui accepte la connexion puis se
    // tait ne bloque pas la requête utilisateur : sans borne, le Promise.allSettled
    // du Service Itinéraire (UF-305) attendrait indéfiniment cette source (C10).
    const started = Date.now();
    let response: Response;

    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw this.toUnavailable(error, operation, started);
    }

    if (!response.ok) {
      this.logger.warn(`OTP ${operation}: HTTP ${response.status} (${Date.now() - started} ms)`);
      throw new OtpUnavailableError(
        'upstream-error',
        `OpenTripPlanner a répondu HTTP ${response.status}.`,
      );
    }

    let payload: OtpGraphQlResponse<T>;
    try {
      payload = (await response.json()) as OtpGraphQlResponse<T>;
    } catch {
      throw new OtpUnavailableError('upstream-error', 'Réponse OpenTripPlanner illisible (JSON).');
    }

    // GraphQL répond 200 même en cas d'erreur applicative : le statut HTTP ne
    // suffit pas à conclure, il faut inspecter le corps.
    if (payload.errors?.length) {
      const details = payload.errors.map((graphQlError) => graphQlError.message).join(' | ');
      this.logger.warn(`OTP ${operation}: erreur GraphQL — ${details}`);
      throw new OtpUnavailableError(
        'upstream-error',
        `Erreur GraphQL OpenTripPlanner : ${details}`,
      );
    }

    if (!payload.data) {
      throw new OtpUnavailableError('upstream-error', 'Réponse OpenTripPlanner sans données.');
    }

    this.logger.debug(`OTP ${operation} : ${Date.now() - started} ms`);
    return payload.data;
  }

  /**
   * Période couverte par le GTFS chargé dans le graphe, mise en cache une heure.
   *
   * Le Service Itinéraire s'en sert pour recaler une date de départ hors période
   * (cf. `alignToServiceWindow`). Sans mémoïsation, chaque recherche paierait un
   * aller-retour réseau pour une donnée qui ne change qu'à la reconstruction du
   * graphe — requête inutile proscrite par l'éco-conception (C5).
   *
   * @param refresh Ignore le cache et réinterroge le moteur. Réservé au contrôle
   *   de santé : un état de service lu dans un cache d'une heure annoncerait un
   *   moteur « opérationnel » une heure après son arrêt, exactement l'inverse de
   *   ce qu'on lui demande.
   * @returns La période couverte, ou `null` si le graphe n'en déclare pas
   * @throws {OtpUnavailableError} si le moteur est injoignable
   */
  async getServiceWindow(refresh = false): Promise<OtpServiceWindow | null> {
    const cached = this.serviceWindowCache;
    if (!refresh && cached && Date.now() - cached.fetchedAt < SERVICE_WINDOW_TTL_MS) {
      return cached.window;
    }

    const data = await this.query<OtpServiceTimeRangeData>(
      '{ serviceTimeRange { start end } }',
      {},
      'serviceTimeRange',
    );

    const range = data.serviceTimeRange;
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) {
      return null;
    }

    const window: OtpServiceWindow = { start: range.start, end: range.end };
    this.serviceWindowCache = { window, fetchedAt: Date.now() };
    return window;
  }

  /** Traduit l'échec de `fetch` en cause exploitable par le mode dégradé (C10). */
  private toUnavailable(error: unknown, operation: string, started: number): OtpUnavailableError {
    // `AbortSignal.timeout` rejette avec un DOMException nommé `TimeoutError` ;
    // un `abort()` manuel donnerait `AbortError`. Les deux signifient « trop long ».
    const name = error instanceof Error ? error.name : '';
    const isTimeout = name === 'TimeoutError' || name === 'AbortError';
    const reason: TransitUnavailableReason = isTimeout ? 'timeout' : 'network';

    // Le message d'erreur système est journalisé, jamais les coordonnées de
    // l'usager : un log ne doit contenir aucune donnée de déplacement (C11).
    this.logger.warn(
      `OTP ${operation} indisponible (${reason}) après ${Date.now() - started} ms : ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );

    return isTimeout
      ? new OtpUnavailableError(
          'timeout',
          `OpenTripPlanner n'a pas répondu en moins de ${this.timeoutMs} ms.`,
        )
      : new OtpUnavailableError('network', 'OpenTripPlanner est injoignable.');
  }
}
