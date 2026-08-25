#!/usr/bin/env bash
#
# Téléchargement des données d'entrée d'OpenTripPlanner (UF-301).
#
#   - GTFS TCL  : horaires théoriques du réseau lyonnais (F3, format standard C9)
#   - OSM Lyon  : réseau piéton/cyclable, indispensable pour relier les arrêts
#                 entre eux et aux adresses de départ/arrivée
#
# Usage :  ./docker/otp/fetch-data.sh          (ou « make otp-data »)
#          ./docker/otp/fetch-data.sh --force  (retélécharge même si présent)
#
# Sources GTFS — voir docs/otp-gtfs.md :
#   * par défaut, le miroir public Mobility Database (aucun compte requis) ;
#   * si GRANDLYON_USER / GRANDLYON_PASSWORD sont définis dans le .env racine,
#     le flux officiel Grand Lyon (à jour) est utilisé à la place.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/data"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

GTFS_FILE="$DATA_DIR/gtfs-tcl.zip"
OSM_FILE="$DATA_DIR/lyon.osm.pbf"

# Miroir public et stable maintenu par MobilityData (licence ODbL, comme la
# source d'origine). Utilisé par défaut pour que le projet se lance sans compte.
GTFS_MIRROR_URL="https://storage.googleapis.com/storage/v1/b/mdb-latest/o/fr-rhone-transports-en-commun-lyonnais-tcl-gtfs-2006.zip?alt=media"
# Flux officiel SYTRAL/Grand Lyon — protégé par authentification HTTP Basic
# depuis la refonte du portail (compte gratuit sur data.grandlyon.com).
GTFS_OFFICIAL_URL="https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP"
# Extrait OSM centré sur l'agglomération lyonnaise (~70 Mo). Nettement plus
# léger que le département ou la région : le graphe se construit plus vite et
# tient dans moins de RAM (C5, éco-conception).
OSM_URL="https://download.bbbike.org/osm/bbbike/Lyon/Lyon.osm.pbf"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

log() { echo "[otp-data] $*"; }
fail() { echo "[otp-data] ERREUR : $*" >&2; exit 1; }

command -v curl >/dev/null || fail "curl est requis."
command -v unzip >/dev/null || fail "unzip est requis."

mkdir -p "$DATA_DIR"

# Les identifiants Grand Lyon vivent dans le .env racine (jamais commité — C4/C11).
# On extrait uniquement les deux clés utiles au lieu de sourcer le fichier : un
# .env rédigé sous Windows porte souvent un BOM UTF-8 et des fins de ligne CRLF,
# que « . .env » interprète comme une commande invalide.
read_env() {
  [ -f "$REPO_ROOT/.env" ] || return 0
  sed -e '1s/^\xEF\xBB\xBF//' -e 's/\r$//' "$REPO_ROOT/.env" \
    | grep -E "^[[:space:]]*$1=" \
    | tail -n 1 \
    | sed -e "s/^[[:space:]]*$1=//" -e 's/^"//' -e 's/"$//'
  # grep ne trouvant rien renvoie 1 : sans neutralisation, `set -e` ferait
  # échouer tout le script alors qu'une variable absente est un cas normal.
  return 0
}

GRANDLYON_USER="${GRANDLYON_USER:-$(read_env GRANDLYON_USER)}"
GRANDLYON_PASSWORD="${GRANDLYON_PASSWORD:-$(read_env GRANDLYON_PASSWORD)}"

# --- GTFS ------------------------------------------------------------------
download_gtfs() {
  if [ -n "${GRANDLYON_USER:-}" ] && [ -n "${GRANDLYON_PASSWORD:-}" ]; then
    log "GTFS : flux officiel Grand Lyon (identifiants détectés dans .env)."
    # --fail : sortie non nulle sur 401/404 au lieu d'écrire une page d'erreur.
    curl -fsSL --retry 3 --max-time 600 \
      -u "$GRANDLYON_USER:$GRANDLYON_PASSWORD" \
      "$GTFS_OFFICIAL_URL" -o "$GTFS_FILE.part" \
      || fail "téléchargement du flux officiel refusé — vérifier GRANDLYON_USER / GRANDLYON_PASSWORD."
  else
    log "GTFS : miroir public Mobility Database (pas d'identifiants Grand Lyon dans .env)."
    log "       → instantané daté ; voir docs/otp-gtfs.md pour passer au flux à jour."
    curl -fsSL --retry 3 --max-time 600 \
      "$GTFS_MIRROR_URL" -o "$GTFS_FILE.part" \
      || fail "téléchargement du miroir GTFS impossible."
  fi

  # Un ZIP corrompu ne se voit qu'au build du graphe, plusieurs minutes plus
  # tard : on valide tout de suite, et on ne remplace le fichier existant
  # qu'après validation (pas de données à moitié écrasées).
  unzip -t "$GTFS_FILE.part" >/dev/null 2>&1 || { rm -f "$GTFS_FILE.part"; fail "archive GTFS illisible."; }
  for required in stops.txt routes.txt trips.txt stop_times.txt; do
    unzip -l "$GTFS_FILE.part" | grep -q "$required" \
      || { rm -f "$GTFS_FILE.part"; fail "l'archive ne contient pas $required — ce n'est pas un GTFS valide."; }
  done
  mv -f "$GTFS_FILE.part" "$GTFS_FILE"
}

# Affiche la fenêtre de validité du flux : c'est elle qui détermine les dates
# interrogeables dans OTP. Un flux périmé construit un graphe valide mais ne
# renvoie aucun itinéraire — le symptôme le plus déroutant de la chaîne.
report_gtfs_validity() {
  local window
  window=$(unzip -p "$GTFS_FILE" calendar.txt 2>/dev/null \
    | tail -n +2 | tr -d '\r' \
    | awk -F',' 'NF>2 { s=$(NF-1); e=$NF; if (min=="" || s<min) min=s; if (e>max) max=e } END { if (min!="") print min" "max }') || true

  [ -n "$window" ] || { log "fenêtre de validité : indéterminée (pas de calendar.txt exploitable)."; return; }

  local start end today
  start=$(echo "$window" | cut -d' ' -f1)
  end=$(echo "$window" | cut -d' ' -f2)
  today=$(date +%Y%m%d)

  log "fenêtre de validité du GTFS : $start → $end"
  if [ "$today" -gt "$end" ] || [ "$today" -lt "$start" ]; then
    log "ATTENTION : la date du jour ($today) est HORS de cette fenêtre."
    log "            OTP construira le graphe mais ne renverra aucun trajet pour aujourd'hui."
    log "            Interroger OTP avec une date comprise dans la fenêtre (voir docs/otp-gtfs.md)."
  fi
}

# --- OSM -------------------------------------------------------------------
download_osm() {
  curl -fsSL --retry 3 --max-time 900 "$OSM_URL" -o "$OSM_FILE.part" \
    || fail "téléchargement de l'extrait OSM impossible."
  # Un .pbf commence par un en-tête « BlobHeader » contenant OSMHeader.
  head -c 100 "$OSM_FILE.part" | grep -q "OSMHeader" \
    || { rm -f "$OSM_FILE.part"; fail "le fichier téléchargé n'est pas un extrait OSM PBF valide."; }
  mv -f "$OSM_FILE.part" "$OSM_FILE"
}

if [ "$FORCE" -eq 1 ] || [ ! -f "$GTFS_FILE" ]; then
  download_gtfs
  log "GTFS enregistré : $GTFS_FILE ($(du -h "$GTFS_FILE" | cut -f1))"
else
  log "GTFS déjà présent — utiliser --force pour retélécharger."
fi
report_gtfs_validity

if [ "$FORCE" -eq 1 ] || [ ! -f "$OSM_FILE" ]; then
  log "OSM : téléchargement de l'extrait lyonnais (~70 Mo)…"
  download_osm
  log "OSM enregistré : $OSM_FILE ($(du -h "$OSM_FILE" | cut -f1))"
else
  log "OSM déjà présent — utiliser --force pour retélécharger."
fi

log "Données prêtes. Étape suivante : « make otp-up » (construit le graphe au premier lancement)."
