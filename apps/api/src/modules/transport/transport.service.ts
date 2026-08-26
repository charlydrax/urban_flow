import { Injectable } from '@nestjs/common';

import { toNetworkDateTime } from './otp/service-date';
import { SharedMobilityService } from './shared-mobility.service';
import { TransitService } from './transit.service';

/** État de disponibilité d'une source de données transport. */
export interface TransportSourceStatus {
  /** Nom de la source (gtfs | gbfs). */
  source: 'gtfs' | 'gbfs';
  /** Disponibilité de la source ('mock' tant que la source n'est pas branchée). */
  status: 'ok' | 'degraded' | 'down' | 'mock';
  /** Horodatage de la dernière vérification. */
  checkedAt: string;
  /** Précision lisible sur l'état constaté (période GTFS couverte, cause de panne). */
  detail?: string;
}

/**
 * Au-delà de ce délai sans nouvelle publication, le flux temps réel est déclaré
 * `degraded`.
 *
 * Un flux de disponibilité vélos se republie en quelques minutes ; un quart
 * d'heure de silence signale une chaîne de collecte à l'arrêt. La donnée reste
 * servie — une station qui existait il y a quinze minutes existe encore — mais
 * le nombre de vélos annoncé n'engage plus grand-chose, et le client a besoin
 * de le savoir pour nuancer son affichage (C10).
 */
const STALE_STATUS_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Service d'intégration transport (F3) — adapte les formats standards GTFS et
 * GBFS (C9) pour le Service Itinéraire.
 *
 * Les calculs eux-mêmes vivent dans `TransitService` (UF-302) et
 * `SharedMobilityService` (UF-303) ; ce service-ci ne fait que rapporter l'état
 * des sources, ce dont le front a besoin pour afficher un bandeau « mode
 * dégradé » (C10).
 */
@Injectable()
export class TransportService {
  constructor(
    private readonly transit: TransitService,
    private readonly sharedMobility: SharedMobilityService,
  ) {}

  /**
   * État des sources de données transport.
   *
   * Les deux sources sont réellement sondées à chaque appel, sans passer par
   * leurs caches — un état lu dans un cache n'est plus un état. C'est la
   * contrepartie assumée d'un diagnostic fiable, et cet endpoint n'est appelé
   * qu'à la demande.
   *
   * Les deux sondes partent **en parallèle** : les interroger l'une après
   * l'autre ferait attendre au diagnostic la somme de deux timeouts, alors
   * qu'une source en panne est précisément le cas où l'on consulte cette page (C10).
   *
   * @returns Statut de chaque source — diagnostic et bandeau dégradé côté front (C10)
   */
  async getStatus(): Promise<TransportSourceStatus[]> {
    const checkedAt = new Date().toISOString();
    const [otp, gbfs] = await Promise.all([this.transit.probe(), this.sharedMobility.probe()]);

    return [
      {
        source: 'gtfs',
        // Injoignable ne veut pas dire « application cassée » : le planificateur
        // continue de fonctionner sans le mode TC (dégradation gracieuse — C10).
        status: otp.reachable ? 'ok' : 'down',
        checkedAt,
        detail: describeOtp(otp),
      },
      {
        source: 'gbfs',
        status: describeGbfsStatus(gbfs),
        checkedAt,
        detail: describeGbfs(gbfs),
      },
    ];
  }
}

/** Formule en clair l'état du moteur de routage, période GTFS comprise. */
function describeOtp(otp: Awaited<ReturnType<TransitService['probe']>>): string {
  if (!otp.reachable) {
    return 'OpenTripPlanner ne répond pas — les trajets en transports en commun ne sont pas proposés.';
  }
  if (!otp.serviceWindow) {
    return 'OpenTripPlanner répond, mais son graphe ne déclare aucune période de service.';
  }

  // Les bornes sont formatées dans le fuseau du réseau, pas en UTC : une période
  // démarrant à minuit heure de Lyon s'afficherait sinon la veille.
  const from = toNetworkDateTime(new Date(otp.serviceWindow.from)).date;
  const to = toNetworkDateTime(new Date(otp.serviceWindow.to)).date;
  return `OpenTripPlanner opérationnel — GTFS couvrant du ${from} au ${to}.`;
}

/** Sonde GBFS telle que rendue par le connecteur mobilités douces. */
type GbfsProbe = Awaited<ReturnType<SharedMobilityService['probe']>>;

/** Âge du flux en millisecondes, `null` si l'opérateur ne date pas sa publication. */
function feedAgeMs(gbfs: GbfsProbe): number | null {
  if (!gbfs.publishedAt) return null;

  const publishedAt = new Date(gbfs.publishedAt).getTime();
  return Number.isNaN(publishedAt) ? null : Date.now() - publishedAt;
}

/** Classe l'état du flux : injoignable, figé, ou opérationnel. */
function describeGbfsStatus(gbfs: GbfsProbe): TransportSourceStatus['status'] {
  if (!gbfs.reachable) return 'down';

  const age = feedAgeMs(gbfs);
  return age !== null && age > STALE_STATUS_THRESHOLD_MS ? 'degraded' : 'ok';
}

/** Formule en clair l'état du flux de mobilité partagée, fraîcheur comprise. */
function describeGbfs(gbfs: GbfsProbe): string {
  if (!gbfs.reachable) {
    return (
      `Le flux GBFS ne répond pas (${gbfs.reason ?? 'cause inconnue'}) — ` +
      'les vélos et trottinettes en libre-service ne sont pas proposés.'
    );
  }

  const age = feedAgeMs(gbfs);
  const stations = `${gbfs.stationCount} station(s) publiée(s)`;

  if (age === null) {
    return `Flux GBFS opérationnel — ${stations}, sans horodatage de publication.`;
  }

  const minutes = Math.max(0, Math.round(age / 60000));
  const freshness = minutes === 0 ? "à l'instant" : `il y a ${minutes} min`;

  return age > STALE_STATUS_THRESHOLD_MS
    ? `Flux GBFS figé — dernière publication ${freshness}, les disponibilités affichées peuvent être périmées.`
    : `Flux GBFS opérationnel — ${stations}, publiées ${freshness}.`;
}
