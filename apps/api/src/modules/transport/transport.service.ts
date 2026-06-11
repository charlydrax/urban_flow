import { Injectable } from '@nestjs/common';

/** État de disponibilité d'une source de données transport. */
export interface TransportSourceStatus {
  /** Nom de la source (gtfs | gbfs). */
  source: 'gtfs' | 'gbfs';
  /** Disponibilité de la source ('mock' tant que F3 n'est pas implémentée). */
  status: 'ok' | 'degraded' | 'down' | 'mock';
  /** Horodatage de la dernière vérification. */
  checkedAt: string;
}

/**
 * Service d'intégration transport (F3) — adapte les formats standards GTFS et
 * GBFS (C9) pour le Service Itinéraire.
 *
 * ⚠️ SQUELETTE : aucune connexion réelle aux flux pour l'instant.
 *
 * Implémentation cible :
 * - `findTransitOptions(from, to)` : lecture GTFS (arrêts, lignes, horaires).
 * - `findSharedMobilityNear(point)` : lecture GBFS (stations vélos/trottinettes).
 * - Appelées EN PARALLÈLE par le Service Itinéraire (`Promise.all` — C10).
 * - Dégradation gracieuse : source indisponible → résultat vide signalé, jamais
 *   d'exception bloquante vers le planificateur (C10).
 *
 * Couvre : F3, C9 (formats standards), C10 (résilience aux pannes externes).
 */
@Injectable()
export class TransportService {
  /**
   * État des sources de données transport (stub).
   * @returns Statut de chaque source — utile au diagnostic et au front (bandeau dégradé)
   */
  async getStatus(): Promise<TransportSourceStatus[]> {
    // TODO(F3): vérifier réellement la fraîcheur des flux GTFS/GBFS
    const checkedAt = new Date().toISOString();
    return [
      { source: 'gtfs', status: 'mock', checkedAt },
      { source: 'gbfs', status: 'mock', checkedAt },
    ];
  }
}
