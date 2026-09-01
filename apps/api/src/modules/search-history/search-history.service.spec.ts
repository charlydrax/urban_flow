import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DEFAULT_SEARCH_HISTORY_LIMIT,
  MAX_SEARCH_HISTORY_LIMIT,
  TransportMode,
} from '@urbanflow/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { CarbonService } from '../carbon/carbon.service';
import { carReferenceGrams, segmentCarbonGrams } from '../carbon/emission-factors';
import { SelectItineraryDto } from './dto/select-itinerary.dto';
import { SearchHistoryService } from './search-history.service';

/**
 * Tests du service Historique de recherche (UF-204).
 *
 * Fige les critères de recette du ticket, complétés par ceux d'UF-807
 * (« trajet réalisé ≠ intention ») :
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
  let deleteModeFootprints: jest.Mock;
  let createModeFootprints: jest.Mock;

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
    carEquivalentGrams: null,
    createdAt,
    completedAt: null,
    ...overrides,
  });

  /** Recherche Part-Dieu → Bellecour (scénario nominal), telle que le planificateur l'ouvre. */
  const trip = () => ({
    from: { label: 'Gare Part-Dieu, 69003 Lyon', lat: 45.7605, lng: 4.8596 },
    to: { label: 'Place Bellecour, 69002 Lyon', lat: 45.7578, lng: 4.832 },
  });

  /** Texte SQL reconstitué (fragments du template, sans les valeurs liées). */
  const sqlOf = (call: unknown[]): string => (call[0] as string[]).join('?');

  /** Valeurs effectivement liées par PostgreSQL, dans l'ordre du template. */
  const paramsOf = (call: unknown[]): unknown[] => call.slice(1);

  beforeEach(async () => {
    queryRaw = jest.fn().mockResolvedValue([dbRow()]);
    deleteModeFootprints = jest.fn().mockResolvedValue({ count: 0 });
    createModeFootprints = jest.fn().mockResolvedValue({ count: 0 });

    // Depuis UF-805, `recordSelection` écrit la sélection ET sa ventilation par
    // mode dans une seule transaction. Le faux `$transaction` exécute le rappel
    // avec le même client : les assertions portent donc sur les mêmes mocks,
    // sans avoir à distinguer ce qui passe par la transaction de ce qui n'y passe pas.
    const prismaMock = {
      $queryRaw: queryRaw,
      tripModeFootprint: { deleteMany: deleteModeFootprints, createMany: createModeFootprints },
      $transaction: (callback: (tx: unknown) => unknown) => callback(prismaMock),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchHistoryService,
        CarbonService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(SearchHistoryService);
  });

  describe('create', () => {
    it('links the row to the user from the token, never to a value from the body', async () => {
      await service.create('user-1', trip());

      // Recette 1 : l'INSERT porte l'identifiant du JWT.
      expect(sqlOf(queryRaw.mock.calls[0])).toContain('INSERT INTO search_history');
      expect(paramsOf(queryRaw.mock.calls[0])).toContain('user-1');
    });

    it('stores both endpoints as PostGIS points in SRID 4326', async () => {
      await service.create('user-1', trip());

      const sql = sqlOf(queryRaw.mock.calls[0]);
      // Recette 3 : géométrie, pas deux flottants ni du texte.
      expect(sql).toContain('ST_SetSRID(ST_MakePoint(');
      expect(sql).toContain('), 4326)');
      expect(sql).not.toContain('from_lat');
    });

    it('passes longitude before latitude to ST_MakePoint', async () => {
      await service.create('user-1', trip());

      // Le piège de PostGIS : ST_MakePoint prend (X, Y) = (lng, lat). Inversé,
      // un trajet lyonnais atterrirait au large de la Somalie — sans erreur.
      const params = paramsOf(queryRaw.mock.calls[0]);
      expect(params.indexOf(4.8596)).toBeLessThan(params.indexOf(45.7605));
      expect(params.indexOf(4.832)).toBeLessThan(params.indexOf(45.7578));
    });

    it('binds every client value as a parameter instead of inlining it in the SQL', async () => {
      await service.create('user-1', trip());

      // C4 / OWASP A03 : le texte SQL ne contient aucune donnée du client.
      const sql = sqlOf(queryRaw.mock.calls[0]);
      expect(sql).not.toContain('Part-Dieu');
      expect(sql).not.toContain('user-1');
      expect(paramsOf(queryRaw.mock.calls[0])).toEqual(
        expect.arrayContaining(['Gare Part-Dieu, 69003 Lyon', 'user-1']),
      );
    });

    it('opens the row with no choice and no journey on it (UF-807)', async () => {
      await service.create('user-1', trip());

      // Une ligne naît vide : ni option retenue, ni empreinte, ni arrivée. Le
      // planificateur ne peut donc pas déclarer un trajet fait avant qu'il ne
      // commence — l'INSERT ne connaît même pas ces colonnes.
      const sql = sqlOf(queryRaw.mock.calls[0]);
      expect(sql).toContain('INSERT INTO search_history (id, user_id,');
      expect(sql).not.toContain('completed_at,');
      expect(sql).not.toContain('carbon_grams,');
    });

    it('returns the entry rebuilt from the geometry columns', async () => {
      const entry = await service.create('user-1', trip());

      expect(entry).toEqual({
        id: 'history-1',
        from: { label: 'Gare Part-Dieu, 69003 Lyon', lat: 45.7605, lng: 4.8596 },
        to: { label: 'Place Bellecour, 69002 Lyon', lat: 45.7578, lng: 4.832 },
        selectedSummary: null,
        // Les deux montants naissent du choix d'itinéraire, qui n'a pas encore
        // eu lieu à l'étape 18 : `null`, et non `0` qui signifierait « trajet à
        // empreinte nulle » et fausserait le bilan (UF-505).
        carbonGrams: null,
        carEquivalentGrams: null,
        // C9 : la date sort en ISO 8601, jamais en objet Date.
        createdAt: '2026-07-31T09:12:00.000Z',
        // UF-807 : le trajet n'a pas eu lieu, et ne comptera donc pas dans le
        // bilan carbone tant que le guidage n'aura pas atteint la destination.
        completedAt: null,
      });
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

  /**
   * Enregistrement de l'itinéraire retenu (UF-505) — ce qui alimente le suivi
   * carbone personnel.
   *
   * Deux points s'y jouent, et ce sont les deux raisons d'être de l'endpoint :
   *  - l'empreinte est **calculée par le Service Carbone**, jamais reçue du
   *    client — sinon n'importe qui s'inscrirait un bilan à zéro (C4) ;
   *  - la mise à jour est verrouillée sur le **couple (ligne, propriétaire)** :
   *    l'UUID vient du chemin, donc du client (C4 / OWASP A01).
   */
  describe('recordSelection', () => {
    /** Option retenue : 400 m de marche puis 4 km de bus. */
    const selection = (overrides: Partial<SelectItineraryDto> = {}): SelectItineraryDto => ({
      selectedSummary: 'Marche + Bus C3',
      segments: [
        { mode: TransportMode.WALK, distanceMeters: 400 },
        { mode: TransportMode.BUS, distanceMeters: 4000 },
      ],
      ...overrides,
    });

    it('prices the chosen itinerary itself instead of trusting the client', async () => {
      await service.recordSelection('user-1', 'history-1', selection());

      const params = paramsOf(queryRaw.mock.calls[0]);

      // Le corps ne porte aucune valeur en grammes : les deux montants écrits
      // sortent du barème appliqué aux segments reçus.
      expect(params).toContain(segmentCarbonGrams(TransportMode.BUS, 4000));
      // La référence voiture porte sur la distance totale, marche comprise —
      // c'est le trajet que l'usager avait à faire.
      expect(params).toContain(carReferenceGrams(4400));
    });

    it('writes the footprint and its car reference together', async () => {
      await service.recordSelection('user-1', 'history-1', selection());

      const sql = sqlOf(queryRaw.mock.calls[0]);

      // Les deux colonnes forment un couple : une empreinte sans sa référence
      // donnerait une ligne dont le bilan ne saurait pas dire ce qu'elle a fait
      // économiser.
      expect(sql).toContain('carbon_grams');
      expect(sql).toContain('car_equivalent_grams');
      expect(sql).toContain('UPDATE search_history');
    });

    it('restricts the update to the row owned by the token holder', async () => {
      await service.recordSelection('user-1', 'history-1', selection());

      const call = queryRaw.mock.calls[0];

      // OWASP A01 : l'identifiant de ligne vient du client, le WHERE porte donc
      // sur le couple — viser la ligne d'autrui ne met rien à jour.
      expect(sqlOf(call)).toContain('WHERE id = ');
      expect(sqlOf(call)).toContain('AND user_id = ');
      expect(paramsOf(call)).toEqual(expect.arrayContaining(['history-1', 'user-1']));
    });

    it('does not mark the trip as travelled (UF-807)', async () => {
      await service.recordSelection('user-1', 'history-1', selection());

      const call = queryRaw.mock.calls[0];

      // Le cœur du ticket : retenir une option est une intention. Le drapeau
      // passé au CASE vaut `false`, donc `completed_at` reste ce qu'il était —
      // et le suivi carbone, qui lit cette colonne, ne compte rien.
      expect(sqlOf(call)).toContain('completed_at');
      expect(paramsOf(call)).toContain(false);
      expect(paramsOf(call)).not.toContain(true);
    });

    it('leaves an already travelled trip untouched instead of revaluing it', async () => {
      // L'UPDATE porte `AND (… OR completed_at IS NULL)` : sur un trajet déjà
      // parcouru, il ne rend rien. Le service relit alors la ligne et la rend
      // telle quelle — cliquer une autre option après être arrivé ne réécrit
      // pas ce qui a été fait, et ce n'est pas une erreur pour autant.
      const travelled = dbRow({
        selectedSummary: 'Marche + Bus C3',
        carbonGrams: 380,
        completedAt: new Date('2026-07-31T09:41:00.000Z'),
      });
      queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([travelled]);

      const entry = await service.recordSelection('user-1', 'history-1', selection());

      expect(entry.completedAt).toBe('2026-07-31T09:41:00.000Z');
      expect(entry.selectedSummary).toBe('Marche + Bus C3');
      // La relecture est un SELECT : rien n'a été réécrit, ventilation comprise.
      expect(sqlOf(queryRaw.mock.calls[1])).toContain('FROM search_history');
      expect(createModeFootprints).not.toHaveBeenCalled();
    });

    it('rejects a row that does not belong to the caller as if it did not exist', async () => {
      // `RETURNING` vide = aucune ligne mise à jour. On ne distingue pas
      // « inconnue » de « pas à vous » : la distinction permettrait d'énumérer
      // les identifiants d'autrui.
      queryRaw.mockResolvedValue([]);

      await expect(service.recordSelection('user-2', 'history-1', selection())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the updated entry, re-read from the database', async () => {
      queryRaw.mockResolvedValue([
        dbRow({ selectedSummary: 'Marche + Bus C3', carbonGrams: 380, carEquivalentGrams: 959 }),
      ]);

      const entry = await service.recordSelection('user-1', 'history-1', selection());

      expect(entry.selectedSummary).toBe('Marche + Bus C3');
      expect(entry.carbonGrams).toBe(380);
      expect(entry.carEquivalentGrams).toBe(959);
    });

    /**
     * UF-805 — la sélection dépose désormais aussi la ventilation par mode du
     * trajet retenu. Sans elle, la répartition par mode et la colonne
     * « Distance » du tableau par trajet resteraient incalculables.
     */
    it('writes the mode breakdown of the chosen itinerary', async () => {
      await service.recordSelection('user-1', 'history-1', selection());

      const [{ data }] = createModeFootprints.mock.calls[0] as [
        { data: { mode: string; distanceMeters: number; grams: number }[] },
      ];

      expect(data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ mode: TransportMode.WALK, distanceMeters: 400, grams: 0 }),
          // 4 km de bus au barème du service — la même valeur que celle qui
          // entre dans `carbon_grams`, puisque c'est le même calcul.
          expect.objectContaining({ mode: TransportMode.BUS, distanceMeters: 4_000 }),
        ]),
      );
    });

    it('folds several segments of the same mode into a single line', async () => {
      await service.recordSelection(
        'user-1',
        'history-1',
        selection({
          segments: [
            { mode: TransportMode.WALK, distanceMeters: 400 },
            { mode: TransportMode.BUS, distanceMeters: 3_000 },
            { mode: TransportMode.WALK, distanceMeters: 200 },
          ],
        }),
      );

      const [{ data }] = createModeFootprints.mock.calls[0] as [
        { data: { mode: string; distanceMeters: number }[] },
      ];

      // Deux bouts de marche autour d'un bus, c'est UNE barre de marche à
      // l'écran — et la contrainte d'unicité `(search_history_id, mode)`
      // refuserait de toute façon deux lignes.
      expect(data).toHaveLength(2);
      expect(data.find((line) => line.mode === TransportMode.WALK)?.distanceMeters).toBe(600);
    });

    it('replaces the previous breakdown when the user changes their mind', async () => {
      await service.recordSelection('user-1', 'history-1', selection());

      // Un second choix sur la même recherche doit refaire la ventilation, pas
      // s'ajouter à la précédente : sinon le même trajet compterait deux fois
      // dans la répartition par mode.
      expect(deleteModeFootprints).toHaveBeenCalledWith({
        where: { searchHistoryId: 'history-1' },
      });
    });

    it('never touches the breakdown of a row owned by someone else (C4 / OWASP A01)', async () => {
      queryRaw.mockResolvedValue([]);

      await expect(service.recordSelection('user-2', 'history-1', selection())).rejects.toThrow(
        NotFoundException,
      );

      // L'effacement des ventilations ne porte que sur `search_history_id`, sans
      // filtre de propriétaire : c'est l'échec de l'UPDATE qui doit l'empêcher
      // d'être atteint. Une inversion de l'ordre des deux écritures rendrait la
      // ventilation d'autrui effaçable en devinant un UUID.
      expect(deleteModeFootprints).not.toHaveBeenCalled();
      expect(createModeFootprints).not.toHaveBeenCalled();
    });
  });

  /**
   * Arrivée du guidage (UF-807) — le correctif de fond du ticket : le suivi
   * carbone doit compter des trajets **parcourus**, pas des clics.
   *
   * Trois choses s'y jouent :
   *  - l'arrivée pose `completed_at`, ce que la sélection ne fait pas ;
   *  - l'heure est celle du serveur (`NOW()`), jamais une date reçue du client ;
   *  - l'appel est **rejouable** : la première arrivée fait foi (`COALESCE`),
   *    ce qu'il faut à un mobile qui peut perdre le réseau en arrivant.
   */
  describe('recordCompletion', () => {
    /** Trajet parcouru : 400 m de marche puis 4 km de bus. */
    const travelled = (): SelectItineraryDto => ({
      selectedSummary: 'Marche + Bus C3',
      segments: [
        { mode: TransportMode.WALK, distanceMeters: 400 },
        { mode: TransportMode.BUS, distanceMeters: 4000 },
      ],
    });

    it('stamps the arrival with the server clock, never with a client date', async () => {
      await service.recordCompletion('user-1', 'history-1', travelled());

      const call = queryRaw.mock.calls[0];

      // C4 : une heure venue du navigateur permettrait de ranger un trajet dans
      // la période de son choix — et l'horloge d'un mobile n'est pas fiable.
      expect(sqlOf(call)).toContain('NOW()');
      expect(paramsOf(call)).toContain(true);
      expect(paramsOf(call).some((value) => value instanceof Date)).toBe(false);
    });

    it('keeps the first arrival when the call is replayed', async () => {
      await service.recordCompletion('user-1', 'history-1', travelled());

      // Un réessai après coupure ne doit ni dupliquer le trajet ni décaler sa
      // date : c'est le COALESCE qui le garantit, côté base.
      expect(sqlOf(queryRaw.mock.calls[0])).toContain('COALESCE(completed_at, NOW())');
    });

    it('prices the travelled itinerary itself, exactly like a selection', async () => {
      await service.recordCompletion('user-1', 'history-1', travelled());

      const params = paramsOf(queryRaw.mock.calls[0]);

      // Aucun gramme ne vient du client, ici non plus : sans quoi il suffirait
      // d'arriver quelque part pour s'inscrire un bilan à zéro (C4).
      expect(params).toContain(segmentCarbonGrams(TransportMode.BUS, 4000));
      expect(params).toContain(carReferenceGrams(4400));
    });

    it('values a trip that was never explicitly selected', async () => {
      // La première option de la liste est cochée sans clic (UF-404) : démarrer
      // le guidage dessus et arriver ne produit aucune sélection préalable. Si
      // l'arrivée ne valorisait pas elle-même, ce trajet — bien réel — pèserait
      // zéro gramme dans le bilan.
      await service.recordCompletion('user-1', 'history-1', travelled());

      expect(sqlOf(queryRaw.mock.calls[0])).toContain('carbon_grams');
      expect(createModeFootprints).toHaveBeenCalled();
    });

    it('restricts the write to the row owned by the token holder', async () => {
      queryRaw.mockResolvedValue([]);

      // OWASP A01 : marquer « réalisé » le trajet d'autrui gonflerait le bilan
      // de quelqu'un d'autre. Même verrou que partout ailleurs dans ce module.
      await expect(service.recordCompletion('user-2', 'history-1', travelled())).rejects.toThrow(
        NotFoundException,
      );
      expect(createModeFootprints).not.toHaveBeenCalled();
    });

    it('returns the entry with its arrival timestamp', async () => {
      queryRaw.mockResolvedValue([
        dbRow({
          selectedSummary: 'Marche + Bus C3',
          carbonGrams: 380,
          carEquivalentGrams: 959,
          completedAt: new Date('2026-07-31T09:41:00.000Z'),
        }),
      ]);

      const entry = await service.recordCompletion('user-1', 'history-1', travelled());

      // C9 : ISO 8601, comme `createdAt`.
      expect(entry.completedAt).toBe('2026-07-31T09:41:00.000Z');
    });
  });
});
