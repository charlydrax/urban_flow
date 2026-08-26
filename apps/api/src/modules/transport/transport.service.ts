import { Injectable } from '@nestjs/common';

import { toNetworkDateTime } from './otp/service-date';
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
 * Service d'intégration transport (F3) — adapte les formats standards GTFS et
 * GBFS (C9) pour le Service Itinéraire.
 *
 * Le calcul de trajets TC lui-même vit dans `TransitService` (UF-302) ; ce
 * service-ci ne fait que rapporter l'état des sources, ce dont le front a besoin
 * pour afficher un bandeau « mode dégradé » (C10).
 *
 * ⚠️ Le volet GBFS reste un stub jusqu'à UF-303.
 */
@Injectable()
export class TransportService {
  constructor(private readonly transit: TransitService) {}

  /**
   * État des sources de données transport.
   *
   * La source GTFS est réellement sondée depuis UF-302 : le moteur de routage
   * auto-hébergé est interrogé à chaque appel, sans passer par le cache — un
   * état lu dans un cache n'est plus un état. C'est la contrepartie assumée
   * d'un diagnostic fiable, et cet endpoint n'est appelé qu'à la demande.
   *
   * @returns Statut de chaque source — diagnostic et bandeau dégradé côté front (C10)
   */
  async getStatus(): Promise<TransportSourceStatus[]> {
    const checkedAt = new Date().toISOString();
    const otp = await this.transit.probe();

    return [
      {
        source: 'gtfs',
        // Injoignable ne veut pas dire « application cassée » : le planificateur
        // continue de fonctionner sans le mode TC (dégradation gracieuse — C10).
        status: otp.reachable ? 'ok' : 'down',
        checkedAt,
        detail: describeOtp(otp),
      },
      // TODO(UF-303): sonder réellement le flux GBFS (vélos/trottinettes).
      { source: 'gbfs', status: 'mock', checkedAt },
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
