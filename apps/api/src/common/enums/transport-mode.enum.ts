/**
 * Modes de transport gérés par le planificateur multimodal (F2/F3).
 * Vocabulaire commun aux modules `users` (préférences), `routes` (segments)
 * et `carbon` (facteurs d'émission) — interopérabilité interne (C9).
 */
export enum TransportMode {
  WALK = 'WALK',
  BIKE = 'BIKE',
  SCOOTER = 'SCOOTER',
  BUS = 'BUS',
  TRAM = 'TRAM',
  METRO = 'METRO',
  CARPOOL = 'CARPOOL',
}
