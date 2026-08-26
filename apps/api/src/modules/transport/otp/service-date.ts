import type { OtpServiceWindow } from './otp.client';

/**
 * Calendrier du réseau : conversion d'un instant en date/heure interrogeables
 * par OpenTripPlanner, et recalage dans la période couverte par le graphe.
 *
 * Fonctions pures, sans I/O — la logique la plus piégeuse du connecteur (fuseaux,
 * jours de la semaine) est ainsi testable sans moteur ni conteneur.
 */

/**
 * Fuseau du réseau modélisé.
 *
 * Le GTFS exprime ses horaires en heure **locale** de l'exploitant, et OTP
 * interprète les paramètres `date`/`time` dans ce fuseau. Formater côté serveur
 * en heure locale de la machine donnerait des résultats différents selon l'hôte
 * (CI en UTC, poste de dev en CET) : le fuseau du réseau TCL est donc figé ici.
 */
export const NETWORK_TIME_ZONE = 'Europe/Paris';

/** Découpage d'un instant dans le fuseau du réseau. */
export interface NetworkDateTime {
  /** Date civile au format `AAAA-MM-JJ`. */
  date: string;
  /** Heure civile au format `HH:MM:SS`. */
  time: string;
}

const DATE_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: NETWORK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TIME_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: NETWORK_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Exprime un instant dans le fuseau du réseau.
 *
 * `en-CA` produit nativement `AAAA-MM-JJ` et `en-GB` en 24 h `HH:MM:SS` : c'est
 * la façon la plus courte d'obtenir ces formats sans dépendance de dates.
 *
 * @param instant Instant à convertir
 * @returns Date et heure civiles, telles qu'attendues par OTP
 */
export function toNetworkDateTime(instant: Date): NetworkDateTime {
  return {
    date: DATE_PARTS.format(instant),
    time: TIME_PARTS.format(instant),
  };
}

/** Convertit `AAAA-MM-JJ` en instant UTC à midi (à l'abri des bascules d'heure d'été). */
function atNoonUtc(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00Z`);
}

/** Formate un instant UTC en date civile `AAAA-MM-JJ`. */
function toIsoDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** Décale une date d'un nombre entier de jours. */
function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Résultat du recalage d'une date de départ. */
export interface AlignedServiceDate {
  /** Date effectivement interrogeable (`AAAA-MM-JJ`). */
  serviceDate: string;
  /** `true` si la date demandée était hors de la période couverte. */
  adjusted: boolean;
}

/**
 * Recale une date de départ dans la période couverte par le graphe.
 *
 * **Pourquoi c'est nécessaire.** Le flux GTFS TCL officiel n'est plus
 * téléchargeable anonymement (HTTP 401) ; l'environnement de développement se
 * rabat sur un miroir public qui est un *instantané daté* (cf. `docs/otp-gtfs.md`).
 * Interroger le graphe à la date du jour ne renverrait donc aucun trajet, et le
 * connecteur paraîtrait cassé alors qu'il fonctionne. Plutôt que de rendre une
 * liste vide, on interroge une date équivalente située dans la période couverte,
 * et le résultat le signale (`dateAdjusted`) pour que rien ne soit masqué.
 *
 * **Le jour de la semaine est conservé** : une demande un mardi reste un mardi.
 * L'offre GTFS d'un dimanche n'a rien à voir avec celle d'un jour ouvré ; recaler
 * sans tenir compte du jour donnerait des horaires trompeurs.
 *
 * En production, avec un GTFS à jour, la date du jour tombe dans la période et
 * cette fonction est un simple passe-plat.
 *
 * @param requestedDate Date demandée (`AAAA-MM-JJ`, fuseau du réseau)
 * @param window Période couverte par le graphe, en secondes epoch (ou `null` si inconnue)
 * @returns La date à interroger et l'indication d'un éventuel recalage
 */
export function alignToServiceWindow(
  requestedDate: string,
  window: OtpServiceWindow | null,
): AlignedServiceDate {
  if (!window) return { serviceDate: requestedDate, adjusted: false };

  const firstDate = toIsoDate(new Date(window.start * 1000));
  const lastDate = toIsoDate(new Date(window.end * 1000));

  // Les dates ISO se comparent correctement en ordre lexicographique.
  if (requestedDate >= firstDate && requestedDate <= lastDate) {
    return { serviceDate: requestedDate, adjusted: false };
  }

  const first = atNoonUtc(firstDate);
  const last = atNoonUtc(lastDate);
  const middle = atNoonUtc(toIsoDate(new Date((first.getTime() + last.getTime()) / 2)));

  // Depuis le milieu de la période, on avance jusqu'au prochain jour de semaine
  // identique à celui demandé — au plus six jours, donc toujours loin des bords
  // sur une période de plusieurs semaines.
  const weekdayShift = (atNoonUtc(requestedDate).getUTCDay() - middle.getUTCDay() + 7) % 7;
  let candidate = addDays(middle, weekdayShift);

  if (candidate.getTime() > last.getTime()) candidate = addDays(candidate, -7);
  // Période plus courte qu'une semaine : aucun jour équivalent n'existe, on se
  // rabat sur le milieu plutôt que de sortir de la fenêtre.
  if (candidate.getTime() < first.getTime()) candidate = middle;

  return { serviceDate: toIsoDate(candidate), adjusted: true };
}
