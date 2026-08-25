#!/usr/bin/env bash
#
# Recette UF-301 — vérifie qu'OpenTripPlanner calcule bien un itinéraire
# transports en commun sur le trajet de référence du projet :
#
#     Lyon Part-Dieu  ->  Bellecour
#
# C'est le scénario nominal décrit dans CLAUDE.md (le trajet de « Marie »).
#
# Usage :  ./docker/otp/test-route.sh [AAAA-MM-JJ]
#          (sans argument, la date est choisie automatiquement dans la
#           fenêtre de validité du GTFS chargé)
set -euo pipefail

OTP_PORT="${OTP_PORT:-8080}"
OTP_URL="http://localhost:$OTP_PORT"

# Coordonnées des deux pôles du scénario de référence.
FROM_LAT=45.760515; FROM_LON=4.859057   # Gare Lyon Part-Dieu
TO_LAT=45.757813;   TO_LON=4.832011     # Place Bellecour

log() { echo "[otp-test] $*"; }
fail() { echo "[otp-test] ECHEC : $*" >&2; exit 1; }

command -v curl >/dev/null || fail "curl est requis."

# --- 1. Le serveur répond-il ? ---------------------------------------------
log "OTP interrogé sur $OTP_URL"
curl -fsS --max-time 10 "$OTP_URL/otp/" >/dev/null \
  || fail "OTP ne répond pas. Démarrer le service (« make otp-up ») et attendre la fin du build du graphe."
log "serveur en ligne."

# --- 2. Choix d'une date interrogeable -------------------------------------
# Le GTFS TCL librement téléchargeable est un instantané daté : interroger OTP
# « aujourd'hui » ne renverrait aucun trajet. On demande donc au serveur la
# période effectivement couverte par le graphe et on vise son milieu, un
# mardi de préférence (jour de semaine à offre pleine).
service_window() {
  curl -fsS --max-time 15 -H 'Content-Type: application/json' \
    -d '{"query":"{ serviceTimeRange { start end } }"}' \
    "$OTP_URL/otp/gtfs/v1" 2>/dev/null
}

pick_date() {
  local raw start end mid
  raw=$(service_window) || return 1
  # Réponse : {"data":{"serviceTimeRange":{"start":<epoch>,"end":<epoch>}}}
  start=$(echo "$raw" | tr -d ' \n' | sed -n 's/.*"start":\([0-9]*\).*/\1/p')
  end=$(echo "$raw" | tr -d ' \n' | sed -n 's/.*"end":\([0-9]*\).*/\1/p')
  [ -n "$start" ] && [ -n "$end" ] || return 1
  mid=$(( (start + end) / 2 ))
  date -u -d "@$mid" +%Y-%m-%d 2>/dev/null || return 1
}

if [ -n "${1:-}" ]; then
  TEST_DATE="$1"
  log "date imposée en argument : $TEST_DATE"
else
  TEST_DATE=$(pick_date) || fail "impossible de déterminer la période couverte par le graphe."
  log "date choisie au milieu de la période couverte par le GTFS : $TEST_DATE"
fi

# --- 3. Requête d'itinéraire ------------------------------------------------
# API GraphQL (« GTFS API ») d'OTP 2 : c'est celle que consommera le connecteur
# du Service Itinéraire (UF-302).
QUERY=$(cat <<GQL
{
  plan(
    from: { lat: $FROM_LAT, lon: $FROM_LON }
    to: { lat: $TO_LAT, lon: $TO_LON }
    date: "$TEST_DATE"
    time: "08:30:00"
    transportModes: [{ mode: TRANSIT }, { mode: WALK }]
    numItineraries: 3
  ) {
    itineraries {
      duration
      startTime
      legs { mode duration distance route { shortName } from { name } to { name } }
    }
  }
}
GQL
)

# L'échappement JSON est délégué à Node (déjà requis par le monorepo) : le
# faire en sed casse dès que la requête contient un guillemet.
PAYLOAD=$(printf '%s' "$QUERY" | node -e 'let q="";process.stdin.on("data",d=>q+=d).on("end",()=>process.stdout.write(JSON.stringify({query:q})))')

log "requête Part-Dieu -> Bellecour le $TEST_DATE à 08:30…"
RESPONSE=$(curl -fsS --max-time 45 -H 'Content-Type: application/json' \
  -d "$PAYLOAD" "$OTP_URL/otp/gtfs/v1") \
  || fail "la requête d'itinéraire a échoué."

# Forme « if » obligatoire : écrite en « grep && fail », la ligne renverrait 1
# quand grep ne trouve rien, et « set -e » ferait sortir le script au moment
# précis où tout va bien.
if echo "$RESPONSE" | grep -q '"errors"'; then
  fail "OTP a renvoyé une erreur : $RESPONSE"
fi

# --- 4. Verdict -------------------------------------------------------------
COUNT=$(echo "$RESPONSE" | grep -o '"duration"' | wc -l)
if [ "$COUNT" -eq 0 ]; then
  fail "aucun itinéraire trouvé. Vérifier que la date $TEST_DATE est dans la fenêtre de validité du GTFS."
fi

log "OK — itinéraire(s) trouvé(s)."
if command -v node >/dev/null 2>&1; then
  echo "$RESPONSE" | node -e '
    let raw = ""; process.stdin.on("data", (d) => (raw += d)).on("end", () => {
      const its = JSON.parse(raw).data.plan.itineraries;
      its.forEach((it, i) => {
        const mins = Math.round(it.duration / 60);
        const legs = it.legs
          .map((l) => (l.route && l.route.shortName ? `${l.mode} ${l.route.shortName}` : l.mode))
          .join(" > ");
        console.log(`  ${i + 1}. ${mins} min : ${legs}`);
      });
    });
  '
else
  echo "$RESPONSE"
fi

log "Recette UF-301 satisfaite : OTP calcule bien un trajet Part-Dieu -> Bellecour."
