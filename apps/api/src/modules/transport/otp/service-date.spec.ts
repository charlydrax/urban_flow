import { alignToServiceWindow, toNetworkDateTime } from './service-date';

/**
 * Recalage de la date de départ dans la période couverte par le graphe.
 *
 * Ce comportement existe parce que le GTFS TCL librement téléchargeable est un
 * instantané daté (cf. `docs/otp-gtfs.md`) : sans recalage, toute recherche à la
 * date du jour renverrait zéro trajet et le connecteur paraîtrait cassé.
 */

/** Période du miroir GTFS utilisé en développement : 14/04/2022 → 13/07/2022. */
const WINDOW = { start: 1649887200, end: 1657663200 };

describe('toNetworkDateTime', () => {
  it('exprime un instant dans le fuseau du réseau, pas dans celui du serveur', () => {
    // 22:30 UTC un 16 mai = 00:30 le 17 mai à Lyon (heure d'été). Formater en
    // UTC ferait interroger OTP sur le mauvais jour d'exploitation.
    const { date, time } = toNetworkDateTime(new Date('2022-05-16T22:30:00Z'));

    expect(date).toBe('2022-05-17');
    expect(time).toBe('00:30:00');
  });
});

describe('alignToServiceWindow', () => {
  it('laisse passer une date déjà couverte par le graphe', () => {
    expect(alignToServiceWindow('2022-05-17', WINDOW)).toEqual({
      serviceDate: '2022-05-17',
      adjusted: false,
    });
  });

  it('recale une date postérieure à la période couverte', () => {
    const { serviceDate, adjusted } = alignToServiceWindow('2026-08-26', WINDOW);

    expect(adjusted).toBe(true);
    expect(serviceDate >= '2022-04-14' && serviceDate <= '2022-07-13').toBe(true);
  });

  it('recale une date antérieure à la période couverte', () => {
    const { serviceDate, adjusted } = alignToServiceWindow('2019-01-01', WINDOW);

    expect(adjusted).toBe(true);
    expect(serviceDate >= '2022-04-14' && serviceDate <= '2022-07-13').toBe(true);
  });

  it('conserve le jour de la semaine demandé', () => {
    // L'offre GTFS d'un dimanche n'a rien à voir avec celle d'un mardi : recaler
    // sans tenir compte du jour donnerait des horaires trompeurs.
    // Indices `getUTCDay` : 0 = dimanche, 3 = mercredi, 6 = samedi.
    const cases: [string, number][] = [
      ['2026-08-26', 3], // mercredi
      ['2026-08-30', 0], // dimanche
      ['2026-08-29', 6], // samedi
    ];

    for (const [requested, weekday] of cases) {
      const { serviceDate } = alignToServiceWindow(requested, WINDOW);
      expect(new Date(`${serviceDate}T12:00:00Z`).getUTCDay()).toBe(weekday);
    }
  });

  it('reste dans la fenêtre même quand elle est plus courte qu’une semaine', () => {
    // 2022-05-17 (mardi) → 2022-05-19 (jeudi) : aucun dimanche disponible.
    const narrow = {
      start: Math.floor(Date.parse('2022-05-17T00:00:00Z') / 1000),
      end: Math.floor(Date.parse('2022-05-19T23:59:59Z') / 1000),
    };

    const { serviceDate, adjusted } = alignToServiceWindow('2026-08-30', narrow);

    expect(adjusted).toBe(true);
    expect(serviceDate >= '2022-05-17' && serviceDate <= '2022-05-19').toBe(true);
  });

  it('ne touche à rien quand le graphe ne déclare aucune période', () => {
    expect(alignToServiceWindow('2026-08-26', null)).toEqual({
      serviceDate: '2026-08-26',
      adjusted: false,
    });
  });
});
