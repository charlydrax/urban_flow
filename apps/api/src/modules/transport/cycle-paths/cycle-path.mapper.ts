import { CycleFacilityType, type CyclePathGeometry } from '@urbanflow/shared';

/**
 * Normalisation des libellés du producteur (UF-304) — fonctions pures.
 *
 * Frontière du module, au même titre que `gbfs.mapper` et `otp.mapper` : rien du
 * vocabulaire de la Métropole de Lyon ne doit franchir ce fichier. Brancher une
 * seconde métropole ne demanderait qu'une table de correspondance de plus.
 */

/**
 * Correspondance libellé producteur → type normalisé.
 *
 * Les clés sont **déjà normalisées** (minuscules, sans accent) par `normalize` :
 * le producteur écrit tantôt « Piste Cyclable », tantôt « Piste cyclable », et
 * un jeu de données de voirie n'a aucune raison d'être stable sur la casse.
 */
const FACILITY_TYPES: Record<string, CycleFacilityType> = {
  'piste cyclable': CycleFacilityType.CYCLE_TRACK,
  'bande cyclable': CycleFacilityType.CYCLE_LANE,
  'voie verte': CycleFacilityType.GREENWAY,
  'double sens cyclable': CycleFacilityType.SHARED_STREET,
  velorue: CycleFacilityType.SHARED_STREET,
  // Chaussée à voie centrale banalisée : une voie centrale partagée, bordée de
  // deux rives cyclables. Fonctionnellement une rue apaisée, pas un site propre.
  'chaussee a voie centrale banalisee (cvcb)': CycleFacilityType.SHARED_STREET,
  'couloir bus velo elargi': CycleFacilityType.BUS_LANE,
  'couloir bus velo non elargi': CycleFacilityType.BUS_LANE,
  'goulotte ou rampe': CycleFacilityType.CROSSING,
};

/**
 * Projette un libellé du producteur sur le vocabulaire interne (C9).
 *
 * Un libellé inconnu devient `OTHER` plutôt que d'écarter le tronçon : à la
 * différence d'un mode de transport faux — qui fausserait le calcul carbone et
 * justifie d'écarter le trajet (cf. `otp.mapper`) —, un type d'aménagement
 * inconnu n'invalide pas l'aménagement. Le tronçon existe, il est cyclable, et
 * le taire appauvrirait la carte.
 *
 * @param sourceLabel Libellé publié (« Bande Cyclable », « Voie verte »…)
 * @returns Type normalisé, `OTHER` si le libellé n'est pas reconnu
 */
export function toCycleFacilityType(sourceLabel: string): CycleFacilityType {
  return FACILITY_TYPES[normalize(sourceLabel)] ?? CycleFacilityType.OTHER;
}

/**
 * Met un libellé sous forme comparable : minuscules, sans accent, sans espaces
 * superflus. `NFD` sépare les lettres de leurs diacritiques, la plage Unicode
 * supprime ensuite ces derniers — « Chaussée » et « CHAUSSEE » se rejoignent.
 */
function normalize(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Relit le GeoJSON produit par `ST_AsGeoJSON` et en garantit la forme.
 *
 * PostGIS rend du texte : sans cette relecture, une chaîne JSON traverserait
 * l'API jusqu'au client, qui devrait la parser lui-même — le contrat annonce un
 * objet GeoJSON (C9), il doit en livrer un.
 *
 * Une géométrie illisible ou d'un autre type lève : ce n'est pas une donnée
 * douteuse à ignorer poliment, c'est le signe que la table contient autre chose
 * que ce que la colonne déclare, et un tracé faux dessinerait une piste là où il
 * n'y en a pas.
 *
 * @param geojson Sortie brute de `ST_AsGeoJSON(geom)`
 * @param sourceId Identifiant du tronçon, pour situer l'anomalie dans le jeu de données
 * @throws {Error} si la chaîne n'est pas un `MultiLineString` GeoJSON valide
 */
export function parseCyclePathGeometry(geojson: string, sourceId: string): CyclePathGeometry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    throw new Error(`Tracé illisible pour le tronçon cyclable ${sourceId}.`);
  }

  if (!isMultiLineString(parsed)) {
    throw new Error(`Tracé inattendu (MultiLineString attendu) pour le tronçon ${sourceId}.`);
  }
  return parsed;
}

/** Vérifie la forme d'un `MultiLineString` GeoJSON : brins de couples `[lng, lat]`. */
function isMultiLineString(value: unknown): value is CyclePathGeometry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };

  return (
    candidate.type === 'MultiLineString' &&
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.every(
      (line) =>
        Array.isArray(line) &&
        line.every(
          (position) =>
            Array.isArray(position) &&
            position.length >= 2 &&
            position.every((coordinate) => typeof coordinate === 'number'),
        ),
    )
  );
}
