import type { CarbonTrip } from '@urbanflow/shared';

import { formatCarbon } from './format-carbon';
import { formatDistance } from './format-distance';
import { formatSearchDate } from './format-search-date';
import { MODE_ICONS } from './itinerary-cards';
import { MODE_TRACK_STYLES } from './route-map-layers';

/**
 * Tableau « Détail par trajet » de la page « Mon impact » (UF-805), et son
 * export.
 *
 * Module **pur**, sans React : il traduit les trajets publiés par
 * `GET /api/carbon/trips` en lignes de tableau, et sait en fabriquer un CSV.
 * Les deux vivent ici parce qu'ils décrivent la même chose — ce que l'écran
 * montre et ce que le fichier contient doivent rester identiques, et deux
 * modules séparés finiraient par diverger d'une colonne.
 *
 * Couvre : C4 (neutralisation des formules dans le CSV, voir
 * {@link escapeCsvField}), C5 (aucun recalcul, l'export réutilise la liste déjà
 * chargée), C7 (chaque ligne est énonçable), C8 (l'export est la donnée de
 * l'usager, rendue à l'usager).
 */

/** Un mode emprunté sur un trajet, réduit à ce que la colonne « Mode » affiche. */
export interface CarbonTripMode {
  key: string;
  /** Pictogramme décoratif, à poser en `aria-hidden` (C7 — WCAG 1.1.1). */
  icon: string;
  label: string;
  color: string;
}

/** Une ligne du tableau par trajet. */
export interface CarbonTripRow {
  /** Identité stable — l'identifiant de la ligne d'historique. */
  key: string;
  /** Date lisible du trajet : « hier, 08:12 », « 27 août ». */
  dateLabel: string;
  /** Trajet parcouru, « République → Bellecour ». */
  routeLabel: string;
  /** Résumé de l'option retenue, ou les modes empruntés à défaut. */
  summaryLabel: string;
  modes: CarbonTripMode[];
  /**
   * Distance parcourue, ou `null` pour un trajet retenu avant UF-805 : sa
   * ventilation n'a jamais été écrite, et « 0 km » serait faux là où
   * « inconnue » est exact.
   */
  distanceLabel: string | null;
  /** Empreinte du trajet, « 204 g CO₂ ». */
  carbonLabel: string;
  /** CO₂ évité par rapport à la voiture, « 908 g CO₂ ». */
  avoidedLabel: string;
  /** La ligne dite en une phrase, pour les technologies d'assistance. */
  description: string;
}

/**
 * Caractères qui font d'une cellule une **formule** dans Excel, LibreOffice et
 * Google Sheets.
 *
 * Un libellé de lieu vient de la saisie de l'usager : rien n'empêche d'appeler
 * un favori `=1+1` — ni, dans un fichier partagé, quelque chose de nettement
 * moins innocent. C'est l'injection de formule CSV (OWASP A03), et elle
 * s'exploite au moment où le fichier est **ouvert**, pas au moment où il est
 * produit.
 */
const CSV_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Échappe une cellule CSV : guillemets doublés, cellule toujours entre
 * guillemets, et formule neutralisée.
 *
 * Toujours entre guillemets même quand ce n'est pas nécessaire : un libellé
 * lyonnais contient des virgules et des points-virgules bien plus souvent qu'on
 * ne le croit (« Lyon, 3e »), et une règle uniforme se relit mieux qu'une règle
 * conditionnelle.
 *
 * Le préfixe apostrophe devant un caractère de formule est la neutralisation
 * recommandée par l'OWASP : le tableur affiche le texte tel quel au lieu de
 * l'évaluer (C4).
 */
function escapeCsvField(value: string): string {
  const guarded = CSV_FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix))
    ? `'${value}`
    : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Nombre au format français — virgule décimale, pour un tableur en français. */
function frenchNumber(value: number, fractionDigits = 0): string {
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * Traduit les trajets publiés par l'API en lignes de tableau (UF-805).
 *
 * @param trips Trajets publiés par `GET /api/carbon/trips`
 * @param now Instant de référence, injectable pour les tests (dates relatives)
 * @returns Une ligne par trajet, dans l'ordre reçu (du plus récent au plus ancien)
 */
export function describeCarbonTrips(trips: CarbonTrip[], now: Date = new Date()): CarbonTripRow[] {
  return trips.map((trip) => {
    const modes: CarbonTripMode[] = trip.modes.map((line) => ({
      key: `${trip.id}:${line.mode}`,
      icon: MODE_ICONS[line.mode],
      label: MODE_TRACK_STYLES[line.mode].label,
      color: MODE_TRACK_STYLES[line.mode].color,
    }));

    const routeLabel = `${trip.fromLabel} → ${trip.toLabel}`;
    // Le résumé serveur d'abord, les modes en repli : une ligne d'historique
    // antérieure à ce champ n'a pas à afficher un blanc là où elle sait dire
    // « Marche + Bus ».
    const summaryLabel = trip.selectedSummary ?? modes.map((mode) => mode.label).join(' + ');
    const distanceLabel = trip.distanceMeters > 0 ? formatDistance(trip.distanceMeters) : null;
    const carbonLabel = formatCarbon(trip.emittedGrams);
    const avoidedLabel = formatCarbon(trip.avoidedGrams);
    const dateLabel = formatSearchDate(trip.createdAt, now);

    return {
      key: trip.id,
      dateLabel,
      routeLabel,
      summaryLabel,
      modes,
      distanceLabel,
      carbonLabel,
      avoidedLabel,
      description:
        `${dateLabel}, ${routeLabel}, ${summaryLabel}` +
        `${distanceLabel ? `, ${distanceLabel}` : ''}, ` +
        `${carbonLabel} émis, ${avoidedLabel} évités par rapport à la voiture.`,
    };
  });
}

/**
 * BOM UTF-8, en tête du fichier exporté.
 *
 * Sans lui, Excel sous Windows lit le CSV avec la page de codes du système et
 * massacre chaque accent de « Croix-Rousse ». Construit par code de caractère
 * plutôt qu'écrit dans un littéral : un caractère invisible dans le source est
 * un caractère que la première relecture venue supprime sans savoir ce qu'elle
 * enlève.
 */
const UTF8_BOM = String.fromCharCode(0xfeff);

/** En-têtes du fichier exporté — l'ordre des colonnes du tableau de la planche. */
const CSV_HEADERS = [
  'Date',
  'Départ',
  'Arrivée',
  'Option retenue',
  'Modes',
  'Distance (km)',
  'CO2 émis (g)',
  'CO2 évité vs voiture (g)',
];

/**
 * Fabrique le CSV de l'export « Exporter mes données » (UF-805).
 *
 * ## Pourquoi le fichier est construit ici et non par l'API
 *
 * La liste des trajets est **déjà chargée** : le tableau l'affiche. Redemander
 * au serveur de la relire, de la sérialiser et de la renvoyer ferait payer un
 * second aller-retour et une seconde requête SQL pour un contenu que le
 * navigateur a sous la main (C5/C10). Le corollaire est assumé : l'export
 * couvre exactement la période affichée, ni plus ni moins, et l'écran annonce
 * la troncature quand l'API la signale (`truncated`).
 *
 * ## Les choix de format, et pourquoi
 *
 * - **Point-virgule** et non virgule : c'est le séparateur qu'attend un tableur
 *   configuré en français, où la virgule est déjà le séparateur décimal.
 * - **BOM UTF-8** en tête : sans lui, Excel sous Windows lit le fichier avec la
 *   page de codes du système et massacre chaque accent de « Croix-Rousse ».
 *   C'est la seule chose qui rende le fichier lisible chez le destinataire.
 * - **Grammes bruts** pour le CO₂, kilomètres à une décimale pour la distance :
 *   l'unité de l'API pour ce qui sera recalculé, l'unité de lecture pour ce qui
 *   sera lu.
 * - **Date ISO** et non date relative : « hier » n'a aucun sens dans un fichier
 *   ouvert trois semaines plus tard.
 *
 * @param trips Trajets à exporter, dans l'ordre d'affichage
 * @returns Le contenu du fichier, BOM compris — prêt pour un `Blob`
 */
export function buildCarbonTripsCsv(trips: CarbonTrip[]): string {
  const lines = [CSV_HEADERS.map(escapeCsvField).join(';')];

  for (const trip of trips) {
    lines.push(
      [
        // `slice(0, 10)` : la date seule suffit à un relevé mensuel, et l'heure
        // exacte d'un déplacement est la donnée la plus ré-identifiante du lot
        // — minimiser jusque dans l'export est la même règle qu'en base (C8).
        escapeCsvField(trip.createdAt.slice(0, 10)),
        escapeCsvField(trip.fromLabel),
        escapeCsvField(trip.toLabel),
        escapeCsvField(trip.selectedSummary ?? ''),
        escapeCsvField(trip.modes.map((mode) => MODE_TRACK_STYLES[mode.mode].label).join(' + ')),
        escapeCsvField(trip.distanceMeters > 0 ? frenchNumber(trip.distanceMeters / 1000, 1) : ''),
        escapeCsvField(frenchNumber(trip.emittedGrams)),
        escapeCsvField(frenchNumber(trip.avoidedGrams)),
      ].join(';'),
    );
  }

  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

/**
 * Nom du fichier exporté, daté de la période — « urbanflow-impact-30j-2026-08-31.csv ».
 *
 * Daté parce qu'un usager qui exporte deux mois de suite se retrouverait sinon
 * avec deux `export.csv`, dont le second écraserait le premier dans son dossier
 * de téléchargements.
 */
export function carbonExportFilename(days: number, now: Date = new Date()): string {
  return `urbanflow-impact-${days}j-${now.toISOString().slice(0, 10)}.csv`;
}
