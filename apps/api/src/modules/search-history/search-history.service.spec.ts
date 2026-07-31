import { Test } from '@nestjs/testing';
import { DEFAULT_SEARCH_HISTORY_LIMIT, MAX_SEARCH_HISTORY_LIMIT } from '@urbanflow/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateSearchHistoryDto } from './dto/create-search-history.dto';
import { SearchHistoryService } from './search-history.service';

/**
 * Tests du service Historique de recherche (UF-204).
 *
 * Fige les critères de recette du ticket :
 *  1. une recherche crée une ligne **rattachée à l'utilisateur du token** ;
 *  2. la lecture est verrouillée sur ce même identifiant — impossible de viser
 *     l'historique d'un autre compte (C4 / OWASP A01) ;
 *  3. les points partent en **géométrie PostGIS** (`ST_MakePoint` en SRID 4326)
 *     et non en texte, avec l'ordre (longitude, latitude) qui est le piège
 *     classique de PostGIS.
 *
 * `$queryRaw` étant un *tagged template*, le mock reçoit le tableau des
 * fragments SQL puis les valeurs liées : on peut donc vérifier séparément **le
 * texte** de la requête et **les paramètres**, et prouver au passage qu'aucune
 * donnée client n'est concaténée dans le SQL (C4 / OWASP A03).
 */
describe('SearchHistoryService', () => {
  let service: SearchHistoryService;
  let queryRaw: jest.Mock;

  const createdAt = new Date('2026-07-31T09:12:00.000Z');

  /** Ligne telle que la renvoient `ST_X`/`ST_Y` après relecture des géométries. */
  const dbRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'history-1',
    fromLabel: 'Gare Part-Dieu, 69003 Lyon',
    fromLat: 45.7605,
    fromLng: 4.8596,
    toLabel: 'Place Bellecour, 69002 Lyon',
    toLat: 45.7578,
    toLng: 4.832,
    selectedSummary: null,
    carbonGrams: null,
    createdAt,
    ...overrides,
  });

  /** Corps validé d'une recherche Part-Dieu → Bellecour (scénario nominal). */
  const dto = (overrides: Partial<CreateSearchHistoryDto> = {}): CreateSearchHistoryDto => ({
    from: { label: 'Gare Part-Dieu, 69003 Lyon', lat: 45.7605, lng: 4.8596 },
    to: { label: 'Place Bellecour, 69002 Lyon', lat: 45.7578, lng: 4.832 },
    ...overrides,
  });

  /** Texte SQL reconstitué (fragments du template, sans les valeurs liées). */
  const sqlOf = (call: unknown[]): string => (call[0] as string[]).join('?');

  /** Valeurs effectivement liées par PostgreSQL, dans l'ordre du template. */
  const paramsOf = (call: unknown[]): unknown[] => call.slice(1);

  beforeEach(async () => {
    queryRaw = jest.fn().mockResolvedValue([dbRow()]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchHistoryService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();

    service = moduleRef.get(SearchHistoryService);
  });

  describe('create', () => {
    it('links the row to the user from the token, never to a value from the body', async () => {
      await service.create('user-1', dto());

      // Recette 1 : l'INSERT porte l'identifiant du JWT.
      expect(sqlOf(queryRaw.mock.calls[0])).toContain('INSERT INTO search_history');
      expect(paramsOf(queryRaw.mock.calls[0])).toContain('user-1');
    });

    it('stores both endpoints as PostGIS points in SRID 4326', async () => {
      await service.create('user-1', dto());

      const sql = sqlOf(queryRaw.mock.calls[0]);
      // Recette 3 : géométrie, pas deux flottants ni du texte.
      expect(sql).toContain('ST_SetSRID(ST_MakePoint(');
      expect(sql).toContain('), 4326)');
      expect(sql).not.toContain('from_lat');
    });

    it('passes longitude before latitude to ST_MakePoint', async () => {
      await service.create('user-1', dto());

      // Le piège de PostGIS : ST_MakePoint prend (X, Y) = (lng, lat). Inversé,
      // un trajet lyonnais atterrirait au large de la Somalie — sans erreur.
      const params = paramsOf(queryRaw.mock.calls[0]);
      expect(params.indexOf(4.8596)).toBeLessThan(params.indexOf(45.7605));
      expect(params.indexOf(4.832)).toBeLessThan(params.indexOf(45.7578));
    });

    it('binds every client value as a parameter instead of inlining it in the SQL', async () => {
      await service.create('user-1', dto({ selectedSummary: 'Marche + Métro B', carbonGrams: 14 }));

      // C4 / OWASP A03 : le texte SQL ne contient aucune donnée du client.
      const sql = sqlOf(queryRaw.mock.calls[0]);
      expect(sql).not.toContain('Part-Dieu');
      expect(sql).not.toContain('user-1');
      expect(paramsOf(queryRaw.mock.calls[0])).toEqual(
        expect.arrayContaining(['Marche + Métro B', 14]),
      );
    });

    it('returns the entry rebuilt from the geometry columns', async () => {
      const entry = await service.create('user-1', dto());

      expect(entry).toEqual({
        id: 'history-1',
        from: { label: 'Gare Part-Dieu, 69003 Lyon', lat: 45.7605, lng: 4.8596 },
        to: { label: 'Place Bellecour, 69002 Lyon', lat: 45.7578, lng: 4.832 },
        selectedSummary: null,
        carbonGrams: null,
        // C9 : la date sort en ISO 8601, jamais en objet Date.
        createdAt: '2026-07-31T09:12:00.000Z',
      });
    });

    it('records an absent summary as null rather than undefined', async () => {
      await service.create('user-1', dto());

      // `undefined` ferait échouer la liaison du paramètre côté driver.
      const params = paramsOf(queryRaw.mock.calls[0]);
      expect(params).toContain(null);
      expect(params).not.toContain(undefined);
    });
  });

  describe('findRecent', () => {
    it('scopes the read to the user from the token', async () => {
      await service.findRecent('user-1');

      // Recette 2 : un compte ne voit QUE son historique — la clause WHERE est
      // la seule porte d'entrée, et sa valeur vient du token.
      expect(sqlOf(queryRaw.mock.calls[0])).toContain('WHERE user_id =');
      expect(paramsOf(queryRaw.mock.calls[0])).toContain('user-1');
    });

    it('serves the default page size when the caller asks for nothing', async () => {
      await service.findRecent('user-1');

      expect(paramsOf(queryRaw.mock.calls[0])).toContain(DEFAULT_SEARCH_HISTORY_LIMIT);
    });

    it('caps an oversized limit instead of trusting the caller', async () => {
      await service.findRecent('user-1', 5_000);

      // C5/C10 : le service reste sûr même si le DTO n'a pas filtré.
      expect(paramsOf(queryRaw.mock.calls[0])).toContain(MAX_SEARCH_HISTORY_LIMIT);
    });

    it('keeps only the most recent occurrence of a repeated trip', async () => {
      await service.findRecent('user-1');

      const sql = sqlOf(queryRaw.mock.calls[0]);
      expect(sql).toContain('DISTINCT ON (from_label, to_label)');
      // Le tri interne décide QUELLE ligne survit : la plus récente.
      expect(sql).toContain('ORDER BY from_label, to_label, created_at DESC');
    });

    it('reprojects the stored geometries into plain coordinates', async () => {
      queryRaw.mockResolvedValue([dbRow(), dbRow({ id: 'history-2' })]);

      const entries = await service.findRecent('user-1');

      expect(sqlOf(queryRaw.mock.calls[0])).toContain('ST_Y(from_geom)');
      expect(entries).toHaveLength(2);
      expect(entries[0].from).toEqual({
        label: 'Gare Part-Dieu, 69003 Lyon',
        lat: 45.7605,
        lng: 4.8596,
      });
    });
  });
});
