import type {
  CycleSegment,
  Itinerary,
  ItinerarySortKey,
  LineStringGeometry,
  RouteGeometrySource,
  RouteSegment,
  SharedMobilityStation,
  TransitJourney,
  TransitLeg,
} from '@urbanflow/shared';

import { segmentCarbonGrams } from '../../carbon/emission-factors';
import { RoutePriority } from '../../../common/enums/route-priority.enum';
import { TransportMode } from '../../../common/enums/transport-mode.enum';
import { distanceMeters, type LatLng } from '../../transport/gbfs/distance';
import type { CollectedSources } from '../sources/collected-sources';
import { cycleCoverage } from './cycle-coverage';
import { toLineString } from './geometry';
import {
  bikeDistanceMeters,
  bikeDurationMinutes,
  walkDistanceMeters,
  walkDurationMinutes,
} from './travel-model';

/**
 * Fusion des trois sources en itinéraires multimodaux (UF-401) — étape 5 du
 * flux de référence (CLAUDE.md §4), et la pièce la plus algorithmique du
 * projet.
 *
 * ## Ce que fait ce module
 *
 * Il reçoit les données **brutes** de la collecte parallèle (UF-305) — trajets
 * TC d'OpenTripPlanner, stations en libre-service aux deux extrémités,
 * tronçons cyclables PostGIS — et en construit des propositions de bout en
 * bout, chacune étant une chaîne continue de segments.
 *
 * Quatre familles sont tentées, dans l'esprit du ticket :
 *
 * | Famille        | Chaîne                                            | Ce qu'elle apporte             |
 * | -------------- | ------------------------------------------------- | ------------------------------ |
 * | `transit`      | marche → TC → marche (tel quel depuis OTP)        | la référence, calculée sur le réseau réel |
 * | `bike-transit` | marche → vélo → TC → marche                       | le rabattement : supprime la longue marche d'accès ou de sortie |
 * | `bike`         | marche → vélo → marche                            | porte-à-porte sans attendre un véhicule |
 * | `walk`         | marche                                            | l'option évidente quand c'est court |
 *
 * ## Fonction pure, et pourquoi
 *
 * Aucune I/O, aucune injection NestJS, aucun accès base : tout est déduit de
 * `CollectedSources`. C'est ce qui permet de tester l'algorithme — le cœur du
 * produit — sans OTP, sans flux GBFS et sans PostGIS, avec des jeux de données
 * figés. Le `RoutesService` reste ainsi un orchestrateur, et la fusion un objet
 * d'étude isolable en soutenance.
 *
 * ## Trois invariants tenus par construction
 *
 * 1. **Continuité géographique** : `segments[i].to` est toujours l'origine de
 *    `segments[i+1]`, en libellé comme en coordonnées. Aucun trou.
 * 2. **Plafond** : au plus {@link MAX_ITINERARIES} propositions, sélectionnées
 *    en préservant la diversité des familles.
 * 3. **Dégradation gracieuse** : une source muette retire les familles qui en
 *    dépendent, elle n'invalide pas les autres (C10).
 *
 * Couvre : F2 (planificateur multimodal), F3 (exploitation GTFS/GBFS/PostGIS),
 * C5 (tout en mémoire, aucun appel supplémentaire), C9 (GeoJSON standard),
 * C10 (dégradation gracieuse), C12 (préférence PMR appliquée en filtre dur).
 */

/** Nombre maximal d'itinéraires retournés (recette 4 du ticket). */
export const MAX_ITINERARIES = 5;

/**
 * Nombre maximal de propositions tout-TC retenues.
 *
 * OTP en renvoie plusieurs, souvent proches (même ligne, départ décalé de
 * quelques minutes). En garder trois laisse de la place aux autres familles
 * sous le plafond : cinq variantes du même métro ne sont pas cinq choix.
 */
export const MAX_TRANSIT_CANDIDATES = 3;

/**
 * Longueur en deçà de laquelle un segment de raccord est absorbé, en mètres.
 *
 * Une borne Vélo'v posée devant l'adresse de départ ne justifie pas un segment
 * « marchez 12 mètres » : il alourdit l'affichage sans rien apprendre. Le
 * segment est supprimé et le libellé reporté sur le suivant — ce qui préserve
 * la continuité de la chaîne.
 */
export const MIN_LEG_METERS = 30;

/**
 * Distance minimale d'un trajet pour qu'une option vélo ait un sens, en mètres.
 *
 * En dessous, le temps de prise et de restitution du vélo (voir
 * `BIKE_HANDLING_MINUTES`) dépasse le gain : proposer un Vélo'v pour six cents
 * mètres est une mauvaise réponse, pas une option supplémentaire.
 */
export const BIKE_MIN_TRIP_METERS = 800;

/**
 * Distance au-delà de laquelle la marche seule n'est plus proposée, en mètres.
 *
 * Environ trente minutes de marche. Le ticket demande « marche seule si courte
 * distance » : au-delà, l'option existe toujours physiquement mais n'est plus
 * une proposition sérieuse, et occuperait une place sous le plafond.
 * Le profil peut resserrer davantage via `maxWalkMinutes`.
 */
export const WALK_ONLY_MAX_METERS = 2500;

/**
 * Distance maximale entre une borne et l'arrêt qu'elle dessert, en mètres.
 *
 * C'est la condition qui rend un rabattement **honnête** : on ne propose de
 * poser le vélo près d'un arrêt que si une borne y est effectivement recensée.
 * Deux cent cinquante mètres, soit trois minutes de marche, est la limite au
 * delà de laquelle le rabattement perd son intérêt.
 */
export const STATION_TO_STOP_MAX_METERS = 250;

/**
 * Longueur minimale de la marche remplacée par un rabattement vélo, en mètres.
 *
 * En deçà, remplacer cinq minutes de marche par « marcher, déverrouiller,
 * pédaler, raccrocher » fait perdre du temps et de la lisibilité.
 */
export const BIKE_FEEDER_MIN_WALK_METERS = 400;

/** Extrémité d'un trajet : un libellé et des coordonnées obligatoires. */
export interface MergeEndpoint extends LatLng {
  label: string;
}

/** Préférences du profil de mobilité appliquées à la fusion (étape 3 du flux). */
export interface MergePreferences {
  /** Modes favoris — influencent la **sélection**, pas l'exclusion (voir plus bas). */
  preferredModes: TransportMode[];
  /** Arbitrage rapidité / empreinte, appliqué au tri final. */
  priority: RoutePriority;
  /** Exige des itinéraires praticables en fauteuil roulant (C12) — filtre dur. */
  reducedMobility: boolean;
  /** Durée de marche maximale acceptée **par segment**, en minutes — filtre dur. */
  maxWalkMinutes: number;
  /**
   * Modes retenus par l'usager **pour cette recherche** (UF-804) — filtre dur.
   *
   * `undefined` quand il n'a rien décoché : la fusion se comporte alors
   * exactement comme avant le ticket. À ne pas confondre avec un tableau vide,
   * qui est une demande explicite (« rien d'autre que la marche »).
   *
   * Pourquoi dur, alors que `preferredModes` ne l'est pas : les deux ne disent
   * pas la même chose. Le profil énonce un goût durable, qu'on n'oppose pas à
   * quelqu'un le jour où seul un bus circule ; le sélecteur de l'écran énonce
   * une contrainte du moment, et une contrainte qui n'exclut rien n'en est pas
   * une. Un usager qui décoche « Métro » et voit trois métros arriver n'a plus
   * aucune raison de croire ce que l'écran lui montre.
   */
  selectedModes?: TransportMode[];
  /**
   * Taille du groupe (UF-804) — exigée des **bornes** en libre-service.
   *
   * N'agit que là : la capacité d'un métro ou d'un bus ne se lit pas dans un
   * GTFS, et prétendre la modéliser reviendrait à inventer une donnée. Une
   * borne, elle, publie le nombre exact de véhicules louables — c'est une
   * information vraie, et la seule que la taille du groupe permette d'exploiter
   * honnêtement.
   */
  travellers: number;
}

/** Résultat de la fusion : les propositions retenues, et l'ordre dans lequel elles le sont. */
export interface MergeResult {
  itineraries: Itinerary[];
  sortedBy: ItinerarySortKey;
}

/** Famille de proposition — sert à garantir la diversité sous le plafond. */
type CandidateFamily = 'transit' | 'bike-transit' | 'bike' | 'walk';

/**
 * Portion élémentaire en cours de construction.
 *
 * Plus riche qu'un `RouteSegment` publié : elle porte aussi les **coordonnées**
 * de ses deux extrémités. C'est ce qui permet de recoller les morceaux (un
 * rabattement remplace les premières portions d'un trajet TC) et de vérifier la
 * continuité, deux choses qu'un libellé seul ne permet pas.
 */
interface Step {
  mode: TransportMode;
  fromLabel: string;
  toLabel: string;
  fromPoint: LatLng;
  toPoint: LatLng;
  durationMinutes: number;
  distanceMeters: number;
  line?: string;
  /**
   * Horaires réels du pas (ISO 8601), quand la **source** les connaît — UF-404.
   *
   * Seuls les pas issus d'un trajet planifié par le moteur GTFS en portent : un
   * horaire de bus est une donnée du réseau. Un pas vélo ou une marche
   * synthétisés à partir d'une distance et d'une vitesse n'ont pas d'horaire
   * propre, et leur en fabriquer un ici ferait passer une estimation pour une
   * donnée de source.
   */
  departureAt?: string;
  arrivalAt?: string;
  /** Tracé du pas, en `[lng, lat]` (GeoJSON — C9). */
  geometry: [number, number][];
  /**
   * D'où vient {@link geometry} — UF-702.
   *
   * Posé **à la construction du pas**, là où l'information existe encore : le
   * moteur a fourni un tracé, ou on a replié sur la droite. Plus loin dans la
   * chaîne, une polyligne de deux points est indiscernable d'un cheminement
   * dont OTP n'aurait rendu que les extrémités.
   *
   * C'est aussi ce qui dit à l'enrichissement (`street-geometry.ts`) quels
   * segments valent un appel au routeur : ceux qui sont déjà `routed` n'ont
   * rien à demander.
   */
  geometrySource: RouteGeometrySource;
}

/** Proposition complète avant filtrage, notation et plafonnement. */
interface Candidate {
  id: string;
  family: CandidateFamily;
  /** Signature des modes et lignes : deux candidats identiques ne sont pas deux choix. */
  signature: string;
  accessible: boolean;
  steps: Step[];
}

/**
 * Construit les itinéraires multimodaux à partir des données brutes des trois
 * sources.
 *
 * Ne lève jamais : une source absente retire des familles de propositions, elle
 * n'interrompt pas la fusion (C10). Un résultat vide est une réponse valide —
 * c'est à l'appelant d'en tirer les conséquences (404 ou liste vide selon
 * l'état des sources).
 *
 * @param sources Données brutes de la collecte parallèle (UF-305)
 * @param from Départ, coordonnées obligatoires (géocodage fait par le client — UF-203)
 * @param to Arrivée, coordonnées obligatoires
 * @param prefs Préférences du compte, lues en base à l'étape 3 du flux
 * @returns Au plus {@link MAX_ITINERARIES} itinéraires, et la clé de tri appliquée
 */
export function mergeIntoItineraries(
  sources: CollectedSources,
  from: MergeEndpoint,
  to: MergeEndpoint,
  prefs: MergePreferences,
): MergeResult {
  const journeys = usableJourneys(sources);
  const cycleSegments = usableCycleSegments(sources);

  const candidates = [
    ...buildTransitCandidates(journeys, from, to),
    ...asList(buildBikeTransitCandidate(journeys, sources, cycleSegments, from, to, prefs)),
    ...asList(buildBikeOnlyCandidate(sources, cycleSegments, from, to, prefs.travellers)),
    ...asList(buildWalkOnlyCandidate(from, to)),
  ];

  const acceptable = dedupe(candidates).filter((candidate) => satisfies(candidate, prefs));
  const selected = selectUnderCap(acceptable, prefs);
  const sortedBy = sortKeyFor(prefs.priority);

  return {
    itineraries: selected.map(toItinerary).sort(comparatorFor(sortedBy)),
    sortedBy,
  };
}

// ---------------------------------------------------------------- les sources

/**
 * Trajets TC réellement exploitables.
 *
 * `status: 'ok'` avec une liste vide veut dire « le moteur a cherché et n'a rien
 * trouvé » : ce n'est pas une panne, mais il n'y a rien à fusionner non plus.
 * Les deux cas se traitent donc pareil ici — sans TC, on construit les autres
 * familles (C10).
 */
function usableJourneys(sources: CollectedSources): TransitJourney[] {
  const transit = sources.transit;
  if (transit.status !== 'ok' || !transit.data || transit.data.status !== 'ok') return [];
  return transit.data.journeys;
}

/**
 * Tronçons cyclables des deux extrémités, réunis en un seul jeu.
 *
 * Réunis plutôt que gardés séparés : la couverture d'un corridor se mesure sur
 * tout ce qu'on connaît, quelle que soit l'extrémité qui l'a fait remonter. Un
 * doublon éventuel ne fausse rien — la mesure est une proximité, pas une somme.
 */
function usableCycleSegments(sources: CollectedSources): CycleSegment[] {
  const data = sources.cyclePaths.status === 'ok' ? sources.cyclePaths.data : null;
  if (!data) return [];
  return [...data.origin.segments, ...data.destination.segments];
}

/** Stations exploitables autour d'une extrémité, `[]` si l'opérateur n'a rien dit. */
function stationsAt(
  sources: CollectedSources,
  end: 'origin' | 'destination',
): SharedMobilityStation[] {
  const data = sources.sharedMobility.status === 'ok' ? sources.sharedMobility.data : null;
  const result = data?.[end];
  if (!result || result.status !== 'ok') return [];
  return result.stations;
}

// ------------------------------------------------------------- famille tout-TC

/**
 * Reprend chaque trajet d'OpenTripPlanner tel quel.
 *
 * Aucune estimation ici : durées, distances et tracés viennent du calcul sur le
 * réseau réel. C'est la famille de référence, celle à laquelle les autres se
 * comparent.
 */
function buildTransitCandidates(
  journeys: readonly TransitJourney[],
  from: MergeEndpoint,
  to: MergeEndpoint,
): Candidate[] {
  return journeys.slice(0, MAX_TRANSIT_CANDIDATES).flatMap((journey, index) => {
    const steps = journeyToSteps(journey, from, to);
    if (steps.length === 0) return [];
    return [
      {
        id: `transit-${index + 1}`,
        family: 'transit' as const,
        signature: signatureOf(steps),
        accessible: journey.accessible,
        steps,
      },
    ];
  });
}

/**
 * Projette les segments d'un trajet TC sur nos pas de construction.
 *
 * Les libellés des deux extrémités sont **réécrits** avec ceux saisis par
 * l'usager : OTP nomme son point de départ « Origin », ce qui n'apprendrait
 * rien à quelqu'un qui vient de taper « Part-Dieu ». Les arrêts intermédiaires,
 * eux, gardent leur nom GTFS — c'est celui écrit sur le quai.
 */
function journeyToSteps(journey: TransitJourney, from: MergeEndpoint, to: MergeEndpoint): Step[] {
  const legs = journey.legs.filter((leg) => leg.distanceMeters > 0 || leg.durationMinutes > 0);
  if (legs.length === 0) return [];

  return legs.map((leg, index) => ({
    mode: leg.mode,
    fromLabel: index === 0 ? from.label : leg.from.name,
    toLabel: index === legs.length - 1 ? to.label : leg.to.name,
    fromPoint: index === 0 ? from : { lat: leg.from.lat, lng: leg.from.lng },
    toPoint: index === legs.length - 1 ? to : { lat: leg.to.lat, lng: leg.to.lng },
    durationMinutes: leg.durationMinutes,
    distanceMeters: leg.distanceMeters,
    ...(leg.line ? { line: leg.line } : {}),
    departureAt: leg.departureAt,
    arrivalAt: leg.arrivalAt,
    ...legGeometry(leg),
  }));
}

/**
 * Tracé d'un segment TC, replié sur une droite si le moteur n'en a pas fourni.
 *
 * Le tracé nominal est celui du GTFS (`shapes.txt`), décodé par le connecteur :
 * un métro y épouse sa ligne au lieu de relier ses arrêts à la règle. Le repli
 * n'arrive que pour un segment dont le flux ne publie pas de forme — il est
 * alors marqué `straight`, et l'affichage le dit (UF-702).
 */
function legGeometry(leg: TransitLeg): Pick<Step, 'geometry' | 'geometrySource'> {
  const coordinates = leg.geometry?.coordinates ?? [];
  if (coordinates.length >= 2) return { geometry: coordinates, geometrySource: 'routed' };

  return {
    geometry: straightLine(
      { lat: leg.from.lat, lng: leg.from.lng },
      { lat: leg.to.lat, lng: leg.to.lng },
    ),
    geometrySource: 'straight',
  };
}

// ------------------------------------------------------ famille vélo seul (VLS)

/**
 * Trajet porte-à-porte en vélo en libre-service.
 *
 * Exige une borne qui **loue** au départ et une borne qui **accepte les
 * retours** à l'arrivée : un vélo qu'on ne peut pas rendre n'est pas un
 * itinéraire. C'est la raison pour laquelle la collecte interroge les deux
 * extrémités (UF-305) et non la seule position de l'usager.
 */
function buildBikeOnlyCandidate(
  sources: CollectedSources,
  cycleSegments: readonly CycleSegment[],
  from: MergeEndpoint,
  to: MergeEndpoint,
  travellers: number,
): Candidate | null {
  if (distanceMeters(from, to) < BIKE_MIN_TRIP_METERS) return null;

  const pickup = nearestRentingStation(stationsAt(sources, 'origin'), from, travellers);
  const dropoff = nearestReturningStation(stationsAt(sources, 'destination'), to, travellers);
  if (!pickup || !dropoff || pickup.id === dropoff.id) return null;

  const steps = compactSteps([
    walkStep(from.label, pickup.name, from, toLatLng(pickup)),
    bikeStep(pickup, dropoff, cycleSegments),
    walkStep(dropoff.name, to.label, toLatLng(dropoff), to),
  ]);
  if (steps.length === 0) return null;

  return {
    id: 'bike',
    family: 'bike',
    signature: signatureOf(steps),
    // Un vélo en libre-service n'est pas une option en fauteuil roulant (C12).
    accessible: false,
    steps,
  };
}

// ------------------------------------------- famille TC + vélo en rabattement

/**
 * Remplace la plus longue marche d'un trajet TC par un rabattement à vélo.
 *
 * ## Le principe
 *
 * Un trajet TC commence et finit presque toujours à pied. Quand cette marche
 * est longue, un Vélo'v la raccourcit — c'est le « rabattement » du ticket. La
 * proposition n'est construite que si les **deux** bornes existent réellement
 * dans les données collectées : celle où l'on prend le vélo, et celle où on le
 * rend près de l'arrêt. Sans quoi on proposerait d'abandonner un vélo sur le
 * trottoir.
 *
 * ## Pourquoi seulement le côté le plus long
 *
 * Rabattre des deux côtés multiplierait les manipulations pour un gain qui
 * s'annule vite, et produirait une proposition difficile à lire. On tente le
 * côté qui pèse le plus ; si les bornes manquent de ce côté, on tente l'autre.
 *
 * ## Et si ça ne fait pas gagner de temps ?
 *
 * La proposition est écartée — sauf si la marche qu'elle remplace dépassait la
 * limite du profil : dans ce cas elle rend praticable un trajet qui ne l'était
 * pas, ce qui vaut mieux qu'une minute gagnée.
 */
function buildBikeTransitCandidate(
  journeys: readonly TransitJourney[],
  sources: CollectedSources,
  cycleSegments: readonly CycleSegment[],
  from: MergeEndpoint,
  to: MergeEndpoint,
  prefs: MergePreferences,
): Candidate | null {
  const journey = journeys[0];
  if (!journey) return null;

  const steps = journeyToSteps(journey, from, to);
  const firstTransit = steps.findIndex((step) => isTransitMode(step.mode));
  const lastTransit = steps.findLastIndex((step) => isTransitMode(step.mode));
  if (firstTransit === -1) return null;

  const access = steps.slice(0, firstTransit);
  const egress = steps.slice(lastTransit + 1);

  // Le côté le plus lourd d'abord : c'est là que le rabattement rapporte.
  const sides: ('access' | 'egress')[] =
    totalDistance(access) >= totalDistance(egress) ? ['access', 'egress'] : ['egress', 'access'];

  for (const side of sides) {
    const replaced = side === 'access' ? access : egress;
    if (totalDistance(replaced) < BIKE_FEEDER_MIN_WALK_METERS) continue;

    const feeder =
      side === 'access'
        ? buildAccessFeeder(steps[firstTransit], sources, cycleSegments, from, prefs.travellers)
        : buildEgressFeeder(steps[lastTransit], sources, cycleSegments, to, prefs.travellers);
    if (!feeder) continue;

    const merged =
      side === 'access'
        ? compactSteps([...feeder, ...steps.slice(firstTransit)])
        : compactSteps([...steps.slice(0, lastTransit + 1), ...feeder]);

    const worthIt =
      totalDuration(merged) < totalDuration(steps) ||
      longestWalkMinutes(replaced) > prefs.maxWalkMinutes;
    if (!worthIt) continue;

    return {
      id: 'bike-transit',
      family: 'bike-transit',
      signature: signatureOf(merged),
      accessible: false,
      steps: merged,
    };
  }

  return null;
}

/**
 * Construit « marche → vélo → marche » du départ jusqu'à l'arrêt d'embarquement.
 *
 * Les deux bornes sont cherchées dans les stations collectées **autour du
 * départ** : c'est le seul jeu de données dont on dispose de ce côté, et un
 * arrêt d'embarquement en est rarement éloigné. Si la borne de dépose n'y
 * figure pas, le rabattement n'est pas construit — on ne suppose pas
 * l'existence d'une station.
 */
function buildAccessFeeder(
  boarding: Step,
  sources: CollectedSources,
  cycleSegments: readonly CycleSegment[],
  from: MergeEndpoint,
  travellers: number,
): Step[] | null {
  const stations = stationsAt(sources, 'origin');
  const pickup = nearestRentingStation(stations, from, travellers);
  const dropoff = nearestReturningStation(
    stations,
    boarding.fromPoint,
    travellers,
    STATION_TO_STOP_MAX_METERS,
  );
  if (!pickup || !dropoff || pickup.id === dropoff.id) return null;

  return compactSteps([
    walkStep(from.label, pickup.name, from, toLatLng(pickup)),
    bikeStep(pickup, dropoff, cycleSegments),
    walkStep(dropoff.name, boarding.fromLabel, toLatLng(dropoff), boarding.fromPoint),
  ]);
}

/** Symétrique du précédent, de l'arrêt de descente jusqu'à l'arrivée. */
function buildEgressFeeder(
  alighting: Step,
  sources: CollectedSources,
  cycleSegments: readonly CycleSegment[],
  to: MergeEndpoint,
  travellers: number,
): Step[] | null {
  const stations = stationsAt(sources, 'destination');
  const pickup = nearestRentingStation(
    stations,
    alighting.toPoint,
    travellers,
    STATION_TO_STOP_MAX_METERS,
  );
  const dropoff = nearestReturningStation(stations, to, travellers);
  if (!pickup || !dropoff || pickup.id === dropoff.id) return null;

  return compactSteps([
    walkStep(alighting.toLabel, pickup.name, alighting.toPoint, toLatLng(pickup)),
    bikeStep(pickup, dropoff, cycleSegments),
    walkStep(dropoff.name, to.label, toLatLng(dropoff), to),
  ]);
}

// ------------------------------------------------------- famille marche seule

/**
 * L'option évidente sur une courte distance — et la seule qui survive à une
 * panne des trois sources externes, puisqu'elle ne dépend d'aucune.
 */
function buildWalkOnlyCandidate(from: MergeEndpoint, to: MergeEndpoint): Candidate | null {
  const meters = walkDistanceMeters(from, to);
  if (meters === 0 || meters > WALK_ONLY_MAX_METERS) return null;

  const steps = [walkStep(from.label, to.label, from, to)];
  return {
    id: 'walk',
    family: 'walk',
    signature: signatureOf(steps),
    // La marche reste le mode le plus accessible ; le relief et la qualité des
    // trottoirs ne sont pas dans nos données, on ne les invente pas (C12).
    accessible: true,
    steps,
  };
}

// ------------------------------------------------------------ stations Vélo'v

/**
 * Une borne qui loue effectivement assez de vélos pour le groupe (UF-804).
 *
 * `travellers` vaut 1 dans le cas courant, et la règle est alors exactement
 * celle d'avant le ticket. Au-delà, elle devient une exigence de comptage : une
 * borne qui affiche deux vélos ne dessert pas un groupe de quatre, et la
 * proposer serait une réponse fausse qui ne se découvre qu'une fois sur place.
 *
 * Le repli sur `vehiclesAvailable` quand l'opérateur ne ventile pas sa flotte
 * est conservé — c'est le seul compte dont on dispose alors.
 */
function canRentBike(station: SharedMobilityStation, travellers: number): boolean {
  if (!station.renting) return false;
  if (station.vehicles.length === 0) return station.vehiclesAvailable >= travellers;

  const bikes = station.vehicles
    .filter((vehicle) => vehicle.mode === TransportMode.BIKE)
    .reduce((total, vehicle) => total + vehicle.count, 0);
  return bikes >= travellers;
}

/**
 * Une borne qui accepte les retours et a la place pour tout le groupe — sinon
 * le trajet ne finit pas, ou pas pour tout le monde.
 */
function canReturnBike(station: SharedMobilityStation, travellers: number): boolean {
  // `docksAvailable` à `null` signifie « non publié », pas « aucune place » :
  // écarter la station reviendrait à punir l'opérateur pour un champ manquant.
  return (
    station.returning && (station.docksAvailable === null || station.docksAvailable >= travellers)
  );
}

/** Borne louante la plus proche d'un point, dans un rayon optionnel. */
function nearestRentingStation(
  stations: readonly SharedMobilityStation[],
  point: LatLng,
  travellers: number,
  maxMeters?: number,
): SharedMobilityStation | null {
  return nearestStation(
    stations.filter((station) => canRentBike(station, travellers)),
    point,
    maxMeters,
  );
}

/** Borne acceptant les retours la plus proche d'un point, dans un rayon optionnel. */
function nearestReturningStation(
  stations: readonly SharedMobilityStation[],
  point: LatLng,
  travellers: number,
  maxMeters?: number,
): SharedMobilityStation | null {
  return nearestStation(
    stations.filter((station) => canReturnBike(station, travellers)),
    point,
    maxMeters,
  );
}

/**
 * La plus proche d'une liste de bornes.
 *
 * La distance est **recalculée** ici plutôt que lue dans `distanceMeters` de la
 * station : ce champ mesure l'écart au point qui a servi à la requête, or on
 * cherche parfois la borne la plus proche d'un arrêt, pas de l'usager.
 */
function nearestStation(
  stations: readonly SharedMobilityStation[],
  point: LatLng,
  maxMeters?: number,
): SharedMobilityStation | null {
  let best: SharedMobilityStation | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const station of stations) {
    const distance = distanceMeters(point, toLatLng(station));
    if (maxMeters !== undefined && distance > maxMeters) continue;
    if (distance < bestDistance) {
      best = station;
      bestDistance = distance;
    }
  }

  return best;
}

/** Réduit une station à ses coordonnées. */
function toLatLng(station: SharedMobilityStation): LatLng {
  return { lat: station.lat, lng: station.lng };
}

// ------------------------------------------------------- fabrication des pas

/** Pas de marche entre deux points, durée et distance estimées (voir `travel-model`). */
function walkStep(fromLabel: string, toLabel: string, fromPoint: LatLng, toPoint: LatLng): Step {
  const meters = walkDistanceMeters(fromPoint, toPoint);
  return {
    mode: TransportMode.WALK,
    fromLabel,
    toLabel,
    fromPoint,
    toPoint,
    durationMinutes: walkDurationMinutes(meters),
    distanceMeters: meters,
    geometry: straightLine(fromPoint, toPoint),
    // La fusion ne route pas : elle synthétise ce pas à partir d'une distance
    // et d'une vitesse, et n'a donc aucun cheminement à publier. Le tracé réel
    // est demandé après coup au routeur de voirie (UF-702) — le pas part
    // `straight`, il ne le reste que si le moteur ne répond pas.
    geometrySource: 'straight',
  };
}

/**
 * Pas à vélo d'une borne à l'autre.
 *
 * C'est ici que les tronçons cyclables (UF-304) entrent réellement dans le
 * calcul : la couverture du corridor réduit le facteur de détour appliqué à la
 * distance à vol d'oiseau, donc la durée annoncée.
 */
function bikeStep(
  pickup: SharedMobilityStation,
  dropoff: SharedMobilityStation,
  cycleSegments: readonly CycleSegment[],
): Step {
  const fromPoint = toLatLng(pickup);
  const toPoint = toLatLng(dropoff);
  const coverage = cycleCoverage(fromPoint, toPoint, cycleSegments);
  const meters = bikeDistanceMeters(fromPoint, toPoint, coverage);

  return {
    mode: TransportMode.BIKE,
    fromLabel: pickup.name,
    toLabel: dropoff.name,
    fromPoint,
    toPoint,
    durationMinutes: bikeDurationMinutes(meters),
    distanceMeters: meters,
    geometry: straightLine(fromPoint, toPoint),
    // Même règle que la marche : le cheminement cyclable est demandé au routeur
    // après la fusion (UF-702).
    geometrySource: 'straight',
  };
}

/**
 * Tracé de repli : la droite entre deux points.
 *
 * C'est le tracé de départ de tout pas que la fusion synthétise. Il est remplacé
 * par le cheminement réel quand le routeur de voirie répond (UF-702), et
 * subsiste — marqué `straight` — quand il ne répond pas.
 */
function straightLine(from: LatLng, to: LatLng): [number, number][] {
  return [
    [from.lng, from.lat],
    [to.lng, to.lat],
  ];
}

/**
 * Supprime les pas négligeables **sans casser la chaîne**.
 *
 * Le libellé et le point du pas supprimé sont reportés sur son voisin, de sorte
 * que `segments[i].to` reste l'origine de `segments[i+1]`. C'est le seul
 * endroit du module où l'invariant de continuité pourrait être rompu : il est
 * donc traité une fois, ici, plutôt que dans chaque constructeur.
 */
function compactSteps(steps: readonly Step[]): Step[] {
  const kept: Step[] = [];

  for (const step of steps) {
    if (step.distanceMeters >= MIN_LEG_METERS) {
      kept.push({ ...step });
      continue;
    }

    // Trop court pour mériter un segment : on le fond dans son voisin
    // précédent. S'il n'y en a pas encore, il sera absorbé par le premier pas
    // conservé, juste après la boucle.
    const previous = kept[kept.length - 1];
    if (previous) {
      previous.toLabel = step.toLabel;
      previous.toPoint = step.toPoint;
      previous.geometry = [...previous.geometry, ...step.geometry];
      // Une portion droite absorbée rend le pas fusionné droit : annoncer
      // `routed` pour un tracé dont une moitié est à vol d'oiseau reviendrait à
      // certifier ce qu'on n'a pas calculé (UF-702).
      if (step.geometrySource === 'straight') previous.geometrySource = 'straight';
      // L'horaire suit la même règle que le libellé : le pas absorbé disparaît,
      // mais le temps qu'il occupait, lui, est bien passé (UF-404).
      if (step.arrivalAt) previous.arrivalAt = step.arrivalAt;
    }
  }

  // Un pas initial négligeable n'a pas de voisin précédent : on reporte son
  // origine sur le premier pas conservé.
  const firstKept = kept[0];
  const firstStep = steps[0];
  if (firstKept && firstStep && firstStep.distanceMeters < MIN_LEG_METERS) {
    firstKept.fromLabel = firstStep.fromLabel;
    firstKept.fromPoint = firstStep.fromPoint;
    if (firstStep.departureAt) firstKept.departureAt = firstStep.departureAt;
  }

  return kept;
}

// ------------------------------------------- préférences, diversité, plafond

/**
 * Filtres **durs** du profil.
 *
 * Deux préférences seulement sont éliminatoires, et le choix est raisonné :
 * - `reducedMobility` n'est pas un goût mais une **contrainte** — proposer un
 *   itinéraire impraticable en fauteuil serait une faute, pas une option de
 *   plus (C12) ;
 * - `maxWalkMinutes` est un **maximum** annoncé comme tel par le profil : le
 *   dépasser reviendrait à ignorer une valeur que l'usager a saisie.
 *
 * `preferredModes`, en revanche, n'exclut rien : un profil « métro et vélo » ne
 * doit pas se retrouver sans réponse le jour où seul un bus circule. Il agit à
 * l'étape suivante, sur la sélection.
 *
 * **UF-804 en ajoute un troisième** : `selectedModes`, le sélecteur de modes de
 * l'écran. Il est éliminatoire là où `preferredModes` ne l'est pas, parce qu'il
 * ne dit pas la même chose — voir {@link MergePreferences.selectedModes}.
 */
function satisfies(candidate: Candidate, prefs: MergePreferences): boolean {
  if (prefs.reducedMobility && !candidate.accessible) return false;
  if (!usesOnlySelectedModes(candidate, prefs.selectedModes)) return false;
  return longestWalkMinutes(candidate.steps) <= prefs.maxWalkMinutes;
}

/**
 * Le candidat n'emprunte-t-il que des modes retenus par l'usager (UF-804) ?
 *
 * La marche est **toujours** admise, qu'elle figure ou non dans la sélection :
 * tout itinéraire commence et finit à pied, et l'exclure ne laisserait aucune
 * proposition constructible — pas même la marche seule. Décocher « Marche » ne
 * peut donc pas vouloir dire « ne pas marcher » ; cela veut dire « pas de
 * marche **seule** », ce que le candidat de la famille `walk` porte à lui seul
 * et que le filtre ci-dessous écarte bien, puisque tous ses modes sont WALK.
 *
 * @param selected `undefined` quand l'usager n'a rien décoché — aucun filtre
 */
function usesOnlySelectedModes(
  candidate: Candidate,
  selected: readonly TransportMode[] | undefined,
): boolean {
  if (!selected) return true;

  const walkOnly = candidate.steps.every((step) => step.mode === TransportMode.WALK);
  if (walkOnly) return selected.includes(TransportMode.WALK);

  return candidate.steps.every(
    (step) => step.mode === TransportMode.WALK || selected.includes(step.mode),
  );
}

/**
 * Retient au plus {@link MAX_ITINERARIES} propositions, en préservant la
 * diversité.
 *
 * L'ordre de sélection est le meilleur de **chaque famille** d'abord, puis le
 * reste au mérite. Sans cela, trois variantes du même métro rempliraient le
 * plafond et masqueraient l'option vélo — alors que c'est précisément la
 * comparaison entre familles que le produit veut provoquer.
 *
 * Le mérite combine, dans cet ordre : le respect des modes favoris du profil,
 * puis la priorité (rapide ou écologique).
 */
function selectUnderCap(candidates: readonly Candidate[], prefs: MergePreferences): Candidate[] {
  const ranked = [...candidates].sort((a, b) => {
    const byPreference = unwantedModeCount(a, prefs) - unwantedModeCount(b, prefs);
    if (byPreference !== 0) return byPreference;
    return priorityValue(a, prefs.priority) - priorityValue(b, prefs.priority);
  });

  const selected: Candidate[] = [];
  const familiesTaken = new Set<CandidateFamily>();

  for (const candidate of ranked) {
    if (familiesTaken.has(candidate.family)) continue;
    familiesTaken.add(candidate.family);
    selected.push(candidate);
    if (selected.length === MAX_ITINERARIES) return selected;
  }

  for (const candidate of ranked) {
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
    if (selected.length === MAX_ITINERARIES) break;
  }

  return selected;
}

/**
 * Nombre de modes du candidat absents des modes favoris.
 *
 * La marche est exclue du décompte : elle n'est pas un choix, elle est le
 * ciment de tout itinéraire multimodal. La pénaliser reviendrait à pénaliser
 * la multimodalité elle-même.
 */
function unwantedModeCount(candidate: Candidate, prefs: MergePreferences): number {
  const modes = new Set(
    candidate.steps.map((step) => step.mode).filter((mode) => mode !== TransportMode.WALK),
  );
  return [...modes].filter((mode) => !prefs.preferredModes.includes(mode)).length;
}

/** Valeur à minimiser selon la priorité du profil (rapide ou écologique). */
function priorityValue(candidate: Candidate, priority: RoutePriority): number {
  return priority === RoutePriority.FASTEST
    ? totalDuration(candidate.steps)
    : totalCarbon(candidate.steps);
}

/** Clé de tri publiée, déduite de la priorité du profil. */
function sortKeyFor(priority: RoutePriority): ItinerarySortKey {
  return priority === RoutePriority.FASTEST ? 'durationAsc' : 'carbonAsc';
}

/**
 * Comparateur de présentation.
 *
 * Le second critère n'est pas décoratif : deux itinéraires à empreinte égale
 * (deux lignes de métro, par exemple) doivent se départager sur la durée, sinon
 * l'ordre dépendrait de celui d'arrivée des sources — donc du hasard réseau.
 *
 * **Exporté depuis UF-502** parce que la fusion n'est plus le dernier à toucher
 * à l'ordre : le Service Itinéraire revalorise ensuite chaque proposition au
 * barème du Service Carbone, puis reclasse. Les deux tris doivent appliquer
 * exactement la même règle — départage compris — sans quoi la liste changerait
 * d'ordre pour une raison qui n'a rien à voir avec le carbone. Une seule
 * définition, deux appelants.
 */
export function comparatorFor(sortedBy: ItinerarySortKey): (a: Itinerary, b: Itinerary) => number {
  if (sortedBy === 'durationAsc') {
    return (a, b) => a.durationMinutes - b.durationMinutes || a.carbonGrams - b.carbonGrams;
  }
  return (a, b) => a.carbonGrams - b.carbonGrams || a.durationMinutes - b.durationMinutes;
}

/** Écarte deux propositions strictement équivalentes (mêmes modes, mêmes lignes). */
function dedupe(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.signature)) return false;
    seen.add(candidate.signature);
    return true;
  });
}

// ------------------------------------------------------------- projection API

/** Projette une proposition retenue sur le contrat public `Itinerary` (C9). */
function toItinerary(candidate: Candidate): Itinerary {
  const segments = candidate.steps.map(toRouteSegment);
  const geometry = assembleGeometry(candidate.steps);
  const window = itineraryWindow(candidate.steps);

  return {
    id: candidate.id,
    summary: summarize(candidate.steps),
    durationMinutes: totalDuration(candidate.steps),
    distanceMeters: candidate.steps.reduce((total, step) => total + step.distanceMeters, 0),
    carbonGrams: segments.reduce((total, segment) => total + segment.carbonGrams, 0),
    accessible: candidate.accessible,
    segments,
    ...(window ?? {}),
    ...(geometry ? { geometry } : {}),
  };
}

/** Une minute en millisecondes — les horaires sont manipulés en epoch. */
const MS_PER_MINUTE = 60_000;

/**
 * Fenêtre horaire porte-à-porte de l'itinéraire (UF-404).
 *
 * ## Ancrage plutôt que déduction
 *
 * Un itinéraire mixte n'est horodaté qu'en partie : le moteur GTFS date ses
 * segments, un rabattement à vélo n'a pour lui qu'une durée. On **ancre** donc
 * la fenêtre sur les segments datés, et on décale les autres de leur propre
 * durée — exactement l'arithmétique que `totalDuration` applique déjà pour
 * annoncer la durée totale. Prendre le bus de 09:47 après onze minutes de vélo,
 * c'est partir à 09:36 ; ce n'est pas une supposition, c'est la définition de
 * la durée qu'on affiche par ailleurs.
 *
 * Ce que ce calcul ne fait **pas** : inventer une heure là où il n'y a aucun
 * ancrage. Un itinéraire entièrement vélo ne part à aucune heure particulière —
 * il part quand l'usager décide, et sa carte n'affichera qu'une durée.
 *
 * @param steps Pas de la proposition, dans l'ordre du trajet
 * @returns `departureAt`/`arrivalAt` ISO 8601, ou `null` si aucun pas n'est daté
 */
function itineraryWindow(
  steps: readonly Step[],
): { departureAt: string; arrivalAt: string } | null {
  const firstDated = steps.findIndex((step) => step.departureAt !== undefined);
  const lastDated = findLastIndex(steps, (step) => step.arrivalAt !== undefined);
  if (firstDated === -1 || lastDated === -1) return null;

  const anchorStart = steps[firstDated]?.departureAt;
  const anchorEnd = steps[lastDated]?.arrivalAt;
  if (!anchorStart || !anchorEnd) return null;

  // Un horaire illisible n'est pas une panne : on n'affiche simplement pas
  // d'heure, plutôt que de publier « Invalid Date » (C10).
  const departure = Date.parse(anchorStart);
  const arrival = Date.parse(anchorEnd);
  if (Number.isNaN(departure) || Number.isNaN(arrival)) return null;

  const leadMinutes = minutesOf(steps.slice(0, firstDated));
  const trailMinutes = minutesOf(steps.slice(lastDated + 1));

  return {
    departureAt: new Date(departure - leadMinutes * MS_PER_MINUTE).toISOString(),
    arrivalAt: new Date(arrival + trailMinutes * MS_PER_MINUTE).toISOString(),
  };
}

/** `Array.prototype.findLastIndex` n'est pas disponible sur la cible ES du projet. */
function findLastIndex(steps: readonly Step[], matches: (step: Step) => boolean): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step && matches(step)) return index;
  }
  return -1;
}

function minutesOf(steps: readonly Step[]): number {
  return steps.reduce((total, step) => total + step.durationMinutes, 0);
}

/** Projette un pas sur un segment publié, empreinte comprise (barème du Service Carbone). */
function toRouteSegment(step: Step): RouteSegment {
  const geometry = stepGeometry(step);

  return {
    mode: step.mode,
    from: step.fromLabel,
    to: step.toLabel,
    durationMinutes: step.durationMinutes,
    distanceMeters: step.distanceMeters,
    carbonGrams: segmentCarbonGrams(step.mode, step.distanceMeters),
    ...(step.line ? { line: step.line } : {}),
    ...(step.departureAt ? { departureAt: step.departureAt } : {}),
    ...(step.arrivalAt ? { arrivalAt: step.arrivalAt } : {}),
    ...(geometry ? { geometry, geometrySource: step.geometrySource } : {}),
  };
}

/**
 * Tracé d'un pas seul, publié pour que la carte puisse colorer par mode (UF-403).
 *
 * Nettoyage et exigence de validité délégués à {@link toLineString}, partagé
 * avec l'assemblage d'ensemble et avec l'enrichissement des cheminements
 * (UF-702) : les trois doivent appliquer la même règle, sinon la carte reçoit
 * un jour une géométrie que MapLibre refuse.
 */
function stepGeometry(step: Step): LineStringGeometry | undefined {
  return toLineString(step.geometry);
}

/**
 * Concatène les tracés des pas en une seule `LineString` (C9).
 *
 * Les points en double à la jonction de deux pas sont supprimés par
 * {@link toLineString} : ils ne changeraient pas le rendu MapLibre mais
 * alourdiraient la réponse pour rien (C5).
 *
 * ⚠️ Cette géométrie d'ensemble est **recalculée** après l'enrichissement des
 * cheminements (UF-702) : remplacer le tracé d'un segment sans reconstruire
 * celui de l'itinéraire laisserait deux réponses contradictoires dans la même
 * charge utile.
 */
function assembleGeometry(steps: readonly Step[]): LineStringGeometry | undefined {
  return toLineString(...steps.map((step) => step.geometry));
}

/**
 * Résumé lisible de la combinaison de modes (« Marche + Métro B + Marche »).
 *
 * Les répétitions consécutives sont fondues : un usager lit « Marche + Métro B »,
 * pas la liste exhaustive de ses pas. C'est le titre de la proposition, pas son
 * détail — le détail, ce sont les segments.
 */
function summarize(steps: readonly Step[]): string {
  const labels: string[] = [];

  for (const step of steps) {
    const label = step.line ? `${MODE_LABELS[step.mode]} ${step.line}` : MODE_LABELS[step.mode];
    if (labels[labels.length - 1] !== label) labels.push(label);
  }

  return labels.join(' + ');
}

/** Libellés d'affichage des modes (UI en français — conventions du projet). */
const MODE_LABELS: Readonly<Record<TransportMode, string>> = {
  [TransportMode.WALK]: 'Marche',
  [TransportMode.BIKE]: 'Vélo',
  [TransportMode.SCOOTER]: 'Trottinette',
  [TransportMode.BUS]: 'Bus',
  [TransportMode.TRAM]: 'Tram',
  [TransportMode.METRO]: 'Métro',
  [TransportMode.CARPOOL]: 'Covoiturage',
};

// ------------------------------------------------------------------ mesures

/** `true` pour un mode embarqué dans un véhicule de transport en commun. */
function isTransitMode(mode: TransportMode): boolean {
  return mode === TransportMode.BUS || mode === TransportMode.TRAM || mode === TransportMode.METRO;
}

function totalDuration(steps: readonly Step[]): number {
  return steps.reduce((total, step) => total + step.durationMinutes, 0);
}

function totalDistance(steps: readonly Step[]): number {
  return steps.reduce((total, step) => total + step.distanceMeters, 0);
}

function totalCarbon(steps: readonly Step[]): number {
  return steps.reduce(
    (total, step) => total + segmentCarbonGrams(step.mode, step.distanceMeters),
    0,
  );
}

/** Marche la plus longue de la chaîne, en minutes — c'est elle que le profil borne. */
function longestWalkMinutes(steps: readonly Step[]): number {
  return steps
    .filter((step) => step.mode === TransportMode.WALK)
    .reduce((longest, step) => Math.max(longest, step.durationMinutes), 0);
}

/** Empreinte des modes et lignes empruntés — deux chaînes égales sont deux fois le même trajet. */
function signatureOf(steps: readonly Step[]): string {
  return steps.map((step) => `${step.mode}:${step.line ?? ''}`).join('>');
}

/** Emballe une valeur éventuellement absente en liste, pour concaténer sans `if`. */
function asList<T>(value: T | null): T[] {
  return value === null ? [] : [value];
}
