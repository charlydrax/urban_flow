import { TransportMode } from '../../common/enums/transport-mode.enum';
import { GRAMS_PER_PASSENGER_KM, segmentCarbonGrams } from './emission-factors';

/**
 * Le barème est provisoire ; son **classement**, lui, ne l'est pas. C'est ce
 * classement qui oriente l'usager vers les mobilités douces, et c'est donc lui
 * qu'on fige : un affinage des valeurs ne doit jamais retourner l'ordre des
 * modes sans que ces tests le signalent.
 */
describe('emission-factors', () => {
  it('ranks the modes from the softest to the most emitting', () => {
    const { WALK, BIKE, TRAM, METRO, SCOOTER, CARPOOL, BUS } = TransportMode;
    const factor = (mode: TransportMode) => GRAMS_PER_PASSENGER_KM[mode];

    expect(factor(WALK)).toBe(0);
    expect(factor(BIKE)).toBeLessThan(factor(TRAM));
    expect(factor(TRAM)).toBeLessThanOrEqual(factor(METRO));
    expect(factor(METRO)).toBeLessThan(factor(SCOOTER));
    expect(factor(SCOOTER)).toBeLessThan(factor(CARPOOL));
    expect(factor(CARPOOL)).toBeLessThan(factor(BUS));
  });

  it('bills a segment in proportion to its distance', () => {
    expect(segmentCarbonGrams(TransportMode.BUS, 1000)).toBe(GRAMS_PER_PASSENGER_KM.BUS);
    expect(segmentCarbonGrams(TransportMode.BUS, 2000)).toBe(2 * GRAMS_PER_PASSENGER_KM.BUS);
  });

  it('charges nothing for walking, whatever the distance', () => {
    expect(segmentCarbonGrams(TransportMode.WALK, 5000)).toBe(0);
  });

  it('never returns a negative or absurd footprint', () => {
    // Une distance nulle, négative ou non finie est un défaut d'appel : elle ne
    // doit ni lever ni produire un crédit carbone.
    expect(segmentCarbonGrams(TransportMode.METRO, 0)).toBe(0);
    expect(segmentCarbonGrams(TransportMode.METRO, -500)).toBe(0);
    expect(segmentCarbonGrams(TransportMode.METRO, Number.NaN)).toBe(0);
  });
});
