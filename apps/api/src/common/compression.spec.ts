import type { Request, Response } from 'express';

import { COMPRESSION_THRESHOLD_BYTES, shouldCompress } from './compression';

/**
 * Recette 3 d'UF-605 : la compression réduit le trafic des parcours clés
 * **sans** comprimer les réponses qui portent un jeton (BREACH — cf. C4).
 *
 * Le filtre est testé en isolation, sans serveur HTTP : c'est précisément la
 * raison pour laquelle la politique vit dans un module pur. Un test qui
 * monterait Express prouverait que `compression` fonctionne — ce qui est le
 * travail de ses auteurs, pas le nôtre. Ce qui nous appartient, et qui doit
 * casser si on le change par inadvertance, c'est la **liste des exclusions**.
 */
describe('Politique de compression (UF-605 — C5/C10)', () => {
  /** Filtre par défaut de `compression`, doublé : il dit toujours oui. */
  const acceptAll = jest.fn(() => true);

  /** Requête minimale — seuls `path` et `headers` sont lus par la politique. */
  const req = (path: string, headers: Request['headers'] = {}) =>
    ({ path, headers }) as Pick<Request, 'path' | 'headers'>;

  /** La réponse n'est jamais inspectée par la politique : un objet vide suffit. */
  const res = {} as Response;

  beforeEach(() => {
    acceptAll.mockClear();
  });

  it('comprime le planificateur, la réponse la plus lourde du système', () => {
    expect(shouldCompress(req('/api/routes/plan'), res, acceptAll)).toBe(true);
  });

  it('comprime les autres routes de données (profil, historique, bilan carbone)', () => {
    expect(shouldCompress(req('/api/search-history'), res, acceptAll)).toBe(true);
    expect(shouldCompress(req('/api/carbon/summary'), res, acceptAll)).toBe(true);
    expect(shouldCompress(req('/api/users/me'), res, acceptAll)).toBe(true);
  });

  /*
   * Le cœur du ticket côté sécurité : ces deux réponses contiennent un
   * `accessToken`. Les comprimer exposerait sa longueur — et, par recoupement,
   * son contenu — à une attaque BREACH.
   */
  it.each(['/api/auth/login', '/api/auth/register'])(
    'ne comprime jamais %s (jeton dans le corps — BREACH)',
    (path) => {
      expect(shouldCompress(req(path), res, acceptAll)).toBe(false);
      // La règle doit trancher AVANT de consulter le filtre par défaut :
      // sinon un futur filtre plus permissif la contournerait.
      expect(acceptAll).not.toHaveBeenCalled();
    },
  );

  it("refuse aussi quand l'échappatoire x-no-compression est posée", () => {
    expect(
      shouldCompress(req('/api/routes/plan', { 'x-no-compression': '1' }), res, acceptAll),
    ).toBe(false);
  });

  it("s'en remet au filtre par défaut pour tout le reste", () => {
    const refuseAll = jest.fn(() => false);
    // Une réponse déjà comprimée (image, archive) : c'est l'heuristique de type
    // de contenu de la bibliothèque qui doit avoir le dernier mot, pas nous.
    expect(shouldCompress(req('/api/docs'), res, refuseAll)).toBe(false);
    expect(refuseAll).toHaveBeenCalled();
  });

  /*
   * Le seuil n'est pas une préférence esthétique : en dessous, l'en-tête gzip
   * coûte plus que ce qu'il économise, et on dépense du CPU des deux côtés du
   * réseau pour transporter davantage d'octets. Le figer dans un test évite
   * qu'un « réglage fin » le ramène à 0 sans que personne ne le remarque.
   */
  it('ne comprime rien en dessous de 1 Ko', () => {
    expect(COMPRESSION_THRESHOLD_BYTES).toBe(1024);
  });
});
