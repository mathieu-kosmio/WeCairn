#!/usr/bin/env bash
# =============================================================================
# WeCairn : tests sur une instance PocketBase jetable
# =============================================================================
# 1. S'assure que le binaire .local/pocketbase existe (via scripts/pb.sh).
# 2. Lance PocketBase sur un port libre (défaut 8099) avec --dir dans un dossier
#    temporaire, les hooks et les migrations du dépôt. Les migrations importent le
#    schéma et appliquent authRule = "verified = true", comme en production.
# 3. Crée le superutilisateur test@example.com / test-password-123.
# 4. Attend /api/health, exporte PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD.
# 5. Exécute `node --test tests/*.test.mjs`, arrête l'instance, nettoie (trap).
# Le code de sortie est celui des tests.
#
# Variables : PB_TEST_PORT (défaut 8099), PB_VERSION (transmise à pb.sh)
# Exportées pour les tests : PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD, PB_FAKE_AI_PORT
# =============================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PB_BIN=".local/pocketbase"
PB_TEST_PORT="${PB_TEST_PORT:-8099}"
TEST_EMAIL="test@example.com"
TEST_PASSWORD="test-password-123"

# --- 1. Binaire -------------------------------------------------------------
if [ ! -x "$PB_BIN" ]; then
  ./scripts/pb.sh --download-only
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node est requis pour exécuter les tests." >&2
  exit 1
fi
if [ ! -d tests ]; then
  echo "Aucun dossier tests/ : rien à exécuter." >&2
  exit 1
fi

# --- 2. Port libre ----------------------------------------------------------
port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}
PORT="$PB_TEST_PORT"
while port_in_use "$PORT"; do
  PORT=$((PORT + 1))
  if [ "$PORT" -gt $((PB_TEST_PORT + 50)) ]; then
    echo "Aucun port libre entre ${PB_TEST_PORT} et ${PORT}." >&2
    exit 1
  fi
done

TMP_DIR="$(mktemp -d)"
PB_DATA_DIR="$TMP_DIR/pb_data"
PB_LOG="$TMP_DIR/pocketbase.log"
PB_PID=""

cleanup() {
  if [ -n "$PB_PID" ] && kill -0 "$PB_PID" 2>/dev/null; then
    kill "$PB_PID" 2>/dev/null || true
    wait "$PB_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$PB_DATA_DIR"

# --- 3. Superutilisateur ----------------------------------------------------
"$PB_BIN" superuser upsert "$TEST_EMAIL" "$TEST_PASSWORD" --dir "$PB_DATA_DIR" --migrationsDir pocketbase/pb_migrations >/dev/null

# --- 4. Lancement et attente ------------------------------------------------
# Le serveur MCP appelle l'API en boucle locale : il doit viser le port de l'instance de test.
# Le relais IA pointe vers un faux fournisseur que tests/ démarre sur PORT+1 (aucune clé réelle).
export WECAIRN_INTERNAL_URL="http://127.0.0.1:${PORT}"
export WECAIRN_AI_BASE_URL="http://127.0.0.1:$((PORT + 1))/v1"
export PB_FAKE_AI_PORT="$((PORT + 1))"
"$PB_BIN" serve \
  --http "127.0.0.1:${PORT}" \
  --dir "$PB_DATA_DIR" \
  --hooksDir pocketbase/pb_hooks \
  --migrationsDir pocketbase/pb_migrations \
  --publicDir web > "$PB_LOG" 2>&1 &
PB_PID=$!

export PB_URL="http://127.0.0.1:${PORT}"
export PB_ADMIN_EMAIL="$TEST_EMAIL"
export PB_ADMIN_PASSWORD="$TEST_PASSWORD"

echo "Instance de test : ${PB_URL} (données : ${PB_DATA_DIR})"
READY=false
for _ in $(seq 1 60); do
  if curl -fsS "${PB_URL}/api/health" >/dev/null 2>&1; then
    READY=true
    break
  fi
  if ! kill -0 "$PB_PID" 2>/dev/null; then
    break
  fi
  sleep 0.5
done
if ! $READY; then
  echo "PocketBase n'a pas démarré sur ${PB_URL}. Journal :" >&2
  cat "$PB_LOG" >&2
  exit 1
fi

# --- 5. Tests ---------------------------------------------------------------
set +e
node --test tests/*.test.mjs
STATUS=$?
set -e

if [ "$STATUS" -ne 0 ]; then
  echo
  echo "Tests en échec (code ${STATUS}). Journal PocketBase :" >&2
  tail -n 50 "$PB_LOG" >&2
fi
exit "$STATUS"
