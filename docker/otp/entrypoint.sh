#!/bin/bash
#
# Entrypoint OTP d'UrbanFlow (UF-301).
#
# Objectif de recette : `docker compose up` doit suffire. Le script décide donc
# seul entre construire le graphe et le recharger :
#
#   1. copie les données (GTFS + OSM) et la configuration depuis les montages
#      en lecture seule vers le répertoire de travail d'OTP ;
#   2. construit le graphe s'il est absent (ou si OTP_FORCE_REBUILD=1) ;
#   3. démarre le serveur en rechargeant le graphe.
#
# Le graphe vit dans un volume nommé : le build (long, gourmand en RAM) n'a
# lieu qu'une fois, les redémarrages suivants sont quasi immédiats (C10,
# et C5 — on ne recalcule pas ce qui est déjà calculé).
set -euo pipefail

OTP_DIR=/var/opentripplanner
SEED_DATA=/var/otp-seed/data
SEED_CONFIG=/var/otp-seed/config
GRAPH_FILE="$OTP_DIR/graph.obj"

log() { echo "[urbanflow-otp] $*"; }

# Reproduit la ligne de commande de l'image officielle : OTP est lancé via le
# classpath calculé par jib, avec le répertoire de base en premier argument.
run_otp() {
  # shellcheck disable=SC2086 # JAVA_OPTS doit être découpé en mots (ex. "-Xmx6g")
  exec java ${JAVA_OPTS:-} \
    -cp @/app/jib-classpath-file @/app/jib-main-class-file \
    "$OTP_DIR/" "$@"
}

build_graph() {
  # shellcheck disable=SC2086
  java ${JAVA_OPTS:-} \
    -cp @/app/jib-classpath-file @/app/jib-main-class-file \
    "$OTP_DIR/" --build --save
}

mkdir -p "$OTP_DIR"

# --- 1. Configuration ------------------------------------------------------
# Recopiée à chaque démarrage : modifier un build-config.json puis relancer
# suffit, sans avoir à reconstruire l'image.
if [ -d "$SEED_CONFIG" ]; then
  cp -f "$SEED_CONFIG"/*.json "$OTP_DIR"/ 2>/dev/null || true
  log "configuration synchronisée depuis $SEED_CONFIG"
fi

# --- 2. Données d'entrée ---------------------------------------------------
# Copie (et non montage direct) : OTP écrit son graphe dans le même répertoire
# que ses entrées, et ce répertoire doit être le volume persistant, pas le
# dossier de l'hôte — on évite ainsi de faire transiter des centaines de Mo
# par le partage de fichiers Docker Desktop à chaque build.
sync_inputs() {
  if [ ! -d "$SEED_DATA" ]; then
    log "ERREUR : le montage $SEED_DATA est absent (vérifier docker-compose.yml)."
    exit 1
  fi

  local found=0
  for f in "$SEED_DATA"/*.zip "$SEED_DATA"/*.pbf "$SEED_DATA"/*.osm; do
    [ -e "$f" ] || continue
    cp -f "$f" "$OTP_DIR"/
    log "entrée copiée : $(basename "$f") ($(du -h "$f" | cut -f1))"
    found=1
  done

  if [ "$found" -eq 0 ]; then
    log "ERREUR : aucune donnée d'entrée dans $SEED_DATA."
    log "         Lancer d'abord « make otp-data » (télécharge le GTFS TCL et le réseau OSM de Lyon)."
    exit 1
  fi
}

# --- 3. Construction conditionnelle du graphe ------------------------------
if [ "${OTP_FORCE_REBUILD:-0}" = "1" ]; then
  log "OTP_FORCE_REBUILD=1 — le graphe existant est supprimé."
  rm -f "$GRAPH_FILE"
fi

if [ -f "$GRAPH_FILE" ]; then
  log "graphe trouvé dans le volume ($(du -h "$GRAPH_FILE" | cut -f1)) — pas de reconstruction."
else
  log "aucun graphe : construction à partir du GTFS et du réseau OSM."
  log "cette étape dure plusieurs minutes et n'a lieu qu'une fois (le volume la conserve)."
  sync_inputs
  build_graph
  log "graphe construit : $GRAPH_FILE"
fi

# --- 4. Service ------------------------------------------------------------
log "démarrage du serveur OTP sur le port 8080."
run_otp --load --serve
