import { TransportMode } from '../../common/enums/transport-mode.enum';
import {
  CAR_REFERENCE_GRAMS_PER_KM,
  GRAMS_PER_PASSENGER_KM,
  carReferenceGrams,
  segmentCarbonGrams,
} from './emission-factors';

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

  it('keeps the car reference above every mode the planner can propose', () => {
    // L'étalon de comparaison (UF-501) n'aurait aucun sens s'il passait sous un
    // mode proposé : « vous avez évité … » deviendrait un reproche.
    const worstProposed = Math.max(...Object.values(GRAMS_PER_PASSENGER_KM));
    expect(CAR_REFERENCE_GRAMS_PER_KM).toBeGreaterThan(worstProposed);
  });

  it('keeps carpooling consistent with the car it shares', () => {
    // Le covoiturage est la voiture divisée par son remplissage moyen (2,5).
    // Faire dériver les deux valeurs indépendamment finirait par produire un
    // covoiturage plus émetteur que la voiture qu'il remplit.
    expect(GRAMS_PER_PASSENGER_KM.CARPOOL).toBeCloseTo(CAR_REFERENCE_GRAMS_PER_KM / 2.5, -1);
    expect(GRAMS_PER_PASSENGER_KM.CARPOOL).toBeLessThan(CAR_REFERENCE_GRAMS_PER_KM);
  });

  it('measures the car reference exactly like a segment', () => {
    // Même arrondi et mêmes gardes : sinon la comparaison publiée compare deux
    // méthodes de calcul autant que deux trajets.
    expect(carReferenceGrams(1000)).toBe(CAR_REFERENCE_GRAMS_PER_KM);
    expect(carReferenceGrams(2500)).toBe(Math.round(CAR_REFERENCE_GRAMS_PER_KM * 2.5));
    expect(carReferenceGrams(0)).toBe(0);
    expect(carReferenceGrams(-1200)).toBe(0);
    expect(carReferenceGrams(Number.NaN)).toBe(0);
  });
});
