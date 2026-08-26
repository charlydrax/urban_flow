import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CycleFacilityType,
  DEFAULT_CYCLE_RADIUS_METERS,
  DEFAULT_CYCLE_SEGMENTS_LIMIT,
  MAX_CYCLE_RADIUS_METERS,
  MAX_CYCLE_SEGMENTS_LIMIT,
  MIN_CYCLE_RADIUS_METERS,
} from '@urbanflow/shared';

import { PrismaService } from '../../../prisma/prisma.service';
import { CyclePathsService } from './cycle-paths.service';

/**
 * Tests du service des tronçons cyclables (UF-304).
 *
 * Fige les critères de recette du ticket :
 *  1. `ST_DWithin` est bien la forme de la requête — c'est le seul prédicat que
 *     l'index GiST sache exploiter, et donc la recette 2 et la recette 3 à la
 *     fois (`EXPLAIN` en base complète la démonstration, cf.
 *     `docs/cycle-paths-postgis.md`) ;
 *  2. la mesure est **métrique** : point casté en `geography`, colonne laissée
 *     telle quelle. Une `geometry` compterait en degrés et un rayon de 300
 *     ratisserait la moitié de la planète ;
 *  3. rien de ce qui vient du client n'est concaténé dans le SQL (C4/OWASP A03) ;
 *  4. le rayon et le volume sont bornés côté service, sans dépendre du DTO (C5).
 *
 * `$queryRaw` étant un *tagged template*, le mock reçoit le tableau des
 * fragments SQL puis les valeurs liées : le **texte** et les **paramètres** se
 * vérifient donc séparément.
 */
describe('CyclePathsService', () => {
  let service: CyclePathsService;
  let queryRaw: jest.Mock;

  const importedAt = new Date('2026-08-26T10:32:00.000Z');

  /** Part-Dieu — point de départ du scénario nominal. */
  const partDieu = { label: 'Gare Part-Dieu', lat: 45.760515, lng: 4.859057 };

  /** Ligne telle que la rend la requête spatiale, alias SQL compris. */
  const dbRow = (overrides: Record<string, unknown> = {}) => ({
    sourceId: '3452',
    name: 'Rue Garibaldi',
    facilityType: 'Piste Cyclable',
    network: 'Voies Lyonnaises',
    surface: 'Matériaux liés (asphaltes, enrobés, bétons et nouveaux liants)',
    distanceMeters: 42,
    lengthMeters: 860,
    geojson: JSON.stringify({
      type: 'MultiLineString',
      coordinates: [
        [
          [4.8591, 45.7604],
          [4.8598, 45.761],
        ],
      ],
    }),
    ...overrides,
  });

  /** Texte SQL reconstitué (fragments du template, sans les valeurs liées). */
  const sqlOf = (call: unknown[]): string => (call[0] as string[]).join('?');

  /** Valeurs effectivement liées par PostgreSQL, dans l'ordre du template. */
  const paramsOf = (call: unknown[]): unknown[] => call.slice(1);

  /** L'appel correspondant à la recherche spatiale (l'autre lit la date d'import). */
  const spatialCall = (): unknown[] =>
    queryRaw.mock.calls.find((call) => sqlOf(call).includes('ST_DWithin')) as unknown[];

  beforeEach(async () => {
    // Les deux lectures partent ensemble (Promise.all) : le mock distingue la
    // recherche spatiale de la lecture de fraîcheur par le texte de la requête.
    queryRaw = jest.fn().mockImplementation((fragments: string[]) => {
      const sql = fragments.join('?');
      if (sql.includes('MAX(imported_at)')) return Promise.resolve([{ importedAt }]);
      return Promise.resolve([dbRow()]);
    });

    const moduleRef = await Test.createTestingModule({
      providers: [CyclePathsService, { provide: PrismaService, useValue: { $queryRaw: queryRaw } }],
    }).compile();

    service = moduleRef.get(CyclePathsService);
  });

  describe('getCycleSegments', () => {
    it('returns the segments found within the radius, sorted by distance', async () => {
      const result = await service.getCycleSegments(partDieu, { radiusMeters: 300 });

      // Recette 2 : ST_DWithin retourne les tronçons du rayon donné.
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]).toMatchObject({
        id: '3452',
        name: 'Rue Garibaldi',
        facilityType: CycleFacilityType.CYCLE_TRACK,
        sourceFacilityType: 'Piste Cyclable',
        distanceMeters: 42,
        lengthMeters: 860,
      });
      expect(result.radiusMeters).toBe(300);
      expect(sqlOf(spatialCall())).toContain('ORDER BY ST_Distance');
    });

    it('parses the PostGIS geometry into a GeoJSON object (C9)', async () => {
      const result = await service.getCycleSegments(partDieu);

      // Le contrat annonce du GeoJSON : le client ne doit pas avoir à parser
      // une chaîne pour afficher un tracé sur la carte.
      expect(result.segments[0].geometry).toEqual({
        type: 'MultiLineString',
        coordinates: [
          [
            [4.8591, 45.7604],
            [4.8598, 45.761],
          ],
        ],
      });
    });

    it('filters with ST_DWithin — the only predicate the GiST index can use (C10)', async () => {
      await service.getCycleSegments(partDieu);

      const sql = sqlOf(spatialCall());
      // Recette 3 : c'est la forme de la requête, pas seulement son résultat,
      // qui conditionne l'usage de l'index. `ST_Distance(...) <= radius`
      // donnerait les mêmes tronçons via un parcours séquentiel complet.
      expect(sql).toContain('ST_DWithin(geom, origin.geog');
      expect(sql).not.toMatch(/WHERE[\s\S]*ST_Distance[\s\S]*<=/);
    });

    it('measures in metres: the query point is cast to geography, the column is not', async () => {
      await service.getCycleSegments(partDieu);

      const sql = sqlOf(spatialCall());
      // Le cast porte sur le point. Caster la colonne (`geom::geography`)
      // donnerait le même résultat en écartant l'index.
      expect(sql).toContain('ST_MakePoint(?, ?), 4326)::geography');
      expect(sql).not.toContain('geom::geography');
    });

    it('passes longitude before latitude to ST_MakePoint', async () => {
      await service.getCycleSegments(partDieu, { radiusMeters: 300 });

      // Le piège classique de PostGIS : ST_MakePoint attend (X, Y). Inverser
      // enverrait tous les tronçons lyonnais au large de la Somalie.
      const params = paramsOf(spatialCall());
      expect(params[0]).toBe(4.859057);
      expect(params[1]).toBe(45.760515);
    });

    it('binds every client value instead of concatenating it (C4 / OWASP A03)', async () => {
      await service.getCycleSegments(partDieu, { radiusMeters: 500, limit: 5 });

      const params = paramsOf(spatialCall());
      expect(params).toEqual(expect.arrayContaining([4.859057, 45.760515, 500, 5]));
      // Aucune coordonnée ne doit apparaître dans le texte de la requête.
      expect(sqlOf(spatialCall())).not.toContain('45.760515');
    });

    it('reports the dataset import date so an empty result stays interpretable', async () => {
      queryRaw.mockImplementation((fragments: string[]) => {
        const sql = fragments.join('?');
        if (sql.includes('MAX(imported_at)')) return Promise.resolve([{ importedAt }]);
        return Promise.resolve([]);
      });

      const result = await service.getCycleSegments(partDieu);

      // « Aucun aménagement ici » et « import jamais lancé » se ressemblent
      // beaucoup dans une réponse JSON : la date les sépare.
      expect(result.segments).toEqual([]);
      expect(result.datasetImportedAt).toBe('2026-08-26T10:32:00.000Z');
    });

    it('reports a null import date when the table has never been populated', async () => {
      queryRaw.mockImplementation((fragments: string[]) => {
        const sql = fragments.join('?');
        if (sql.includes('MAX(imported_at)')) return Promise.resolve([{ importedAt: null }]);
        return Promise.resolve([]);
      });

      const result = await service.getCycleSegments(partDieu);

      expect(result.datasetImportedAt).toBeNull();
    });

    it('applies the default radius and limit when none are given', async () => {
      await service.getCycleSegments(partDieu);

      const params = paramsOf(spatialCall());
      expect(params).toContain(DEFAULT_CYCLE_RADIUS_METERS);
      expect(params).toContain(DEFAULT_CYCLE_SEGMENTS_LIMIT);
    });

    it('clamps the radius on both ends, without relying on the DTO (C5/C6)', async () => {
      // Défense en profondeur : le Service Itinéraire appellera ce service
      // directement, sans passer par la validation HTTP.
      await service.getCycleSegments(partDieu, { radiusMeters: 5 });
      expect(paramsOf(spatialCall())).toContain(MIN_CYCLE_RADIUS_METERS);

      queryRaw.mockClear();
      await service.getCycleSegments(partDieu, { radiusMeters: 50_000 });
      expect(paramsOf(spatialCall())).toContain(MAX_CYCLE_RADIUS_METERS);

      queryRaw.mockClear();
      await service.getCycleSegments(partDieu, { radiusMeters: Number.NaN });
      expect(paramsOf(spatialCall())).toContain(DEFAULT_CYCLE_RADIUS_METERS);
    });

    it('caps the number of segments returned (C5)', async () => {
      await service.getCycleSegments(partDieu, { limit: 10_000 });

      expect(paramsOf(spatialCall())).toContain(MAX_CYCLE_SEGMENTS_LIMIT);
    });

    it('rejects coordinates that do not designate a place on Earth', async () => {
      // Sans ce garde-fou, une coordonnée aberrante rendrait une liste vide
      // impossible à distinguer d'un quartier sans aménagement cyclable.
      await expect(
        service.getCycleSegments({ label: 'Nulle part', lat: 145, lng: 4.85 }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.getCycleSegments({ label: 'Nulle part', lat: 45.76, lng: Number.NaN }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(queryRaw).not.toHaveBeenCalled();
    });
  });
});
