#!/usr/bin/env bash
# =============================================================================
# WeCairn : serveur de développement PocketBase
# =============================================================================
# 1. Détecte le système (darwin/linux) et l'architecture (arm64/amd64).
# 2. Télécharge le binaire PocketBase PB_VERSION dans .local/pocketbase s'il
#    manque ou si la version enregistrée dans .local/pb_version diffère.
# 3. Charge .local/env.sh s'il existe (variables WECAIRN_*, PB_ADMIN_*, PB_PORT).
# 4. Crée ou met à jour le superutilisateur si PB_ADMIN_EMAIL et
#    PB_ADMIN_PASSWORD sont définis.
# 5. Lance `serve` au premier plan (ou en arrière-plan avec --background).
#
# Usage : scripts/pb.sh [--background] [--download-only]
#   --background     lance le serveur avec nohup, journal dans .local/server.log
#   --download-only  télécharge le binaire et s'arrête (utilisé par scripts/test.sh)
#
# Variables : PB_VERSION (défaut 0.40.3), PB_PORT (défaut 8090),
#             PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD, WECAIRN_* (voir docs/deploiement.md)
# =============================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PB_VERSION="${PB_VERSION:-0.40.3}"
LOCAL_DIR=".local"
PB_BIN="$LOCAL_DIR/pocketbase"
PB_VERSION_FILE="$LOCAL_DIR/pb_version"
PB_DATA_DIR="$LOCAL_DIR/pb_data"
PB_LOG="$LOCAL_DIR/server.log"

BACKGROUND=false
DOWNLOAD_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --background) BACKGROUND=true ;;
    --download-only) DOWNLOAD_ONLY=true ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Option inconnue : $arg (voir --help)" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$LOCAL_DIR"

# --- 1. Système et architecture ---------------------------------------------
detect_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *)
      echo "Système non pris en charge : $(uname -s) (darwin ou linux attendu)" >&2
      exit 1
      ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="amd64" ;;
    *)
      echo "Architecture non prise en charge : $(uname -m) (arm64 ou amd64 attendu)" >&2
      exit 1
      ;;
  esac
  echo "${os}_${arch}"
}

# --- 2. Téléchargement du binaire -------------------------------------------
download_pocketbase() {
  local platform url zip
  platform="$(detect_platform)"
  url="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${platform}.zip"
  zip="$LOCAL_DIR/pocketbase.zip"

  echo "Téléchargement de PocketBase ${PB_VERSION} (${platform})..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$zip"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$zip"
  else
    echo "curl ou wget est requis pour télécharger PocketBase." >&2
    exit 1
  fi

  # Contrôle d'intégrité contre checksums.txt de la même release (archive tronquée ou altérée en route).
  local sums expected actual
  sums="$(curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt" 2>/dev/null \
    || wget -qO- "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt")"
  expected="$(printf '%s\n' "$sums" | awk -v f="pocketbase_${PB_VERSION}_${platform}.zip" '$2 == f { print $1 }')"
  if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$zip" | cut -d' ' -f1)"; else actual="$(shasum -a 256 "$zip" | cut -d' ' -f1)"; fi
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    rm -f "$zip"
    echo "Empreinte SHA-256 de PocketBase invalide ou introuvable (attendu : ${expected:-?}, obtenu : ${actual})." >&2
    exit 1
  fi

  if ! command -v unzip >/dev/null 2>&1; then
    echo "unzip est requis pour extraire PocketBase." >&2
    exit 1
  fi
  rm -f "$PB_BIN"
  unzip -q -o "$zip" pocketbase -d "$LOCAL_DIR"
  rm -f "$zip"
  chmod +x "$PB_BIN"
  echo "$PB_VERSION" > "$PB_VERSION_FILE"
  echo "PocketBase ${PB_VERSION} installé dans ${PB_BIN}."
}

CURRENT_VERSION=""
[ -f "$PB_VERSION_FILE" ] && CURRENT_VERSION="$(tr -d '[:space:]' < "$PB_VERSION_FILE")"
if [ ! -x "$PB_BIN" ] || [ "$CURRENT_VERSION" != "$PB_VERSION" ]; then
  download_pocketbase
fi

if $DOWNLOAD_ONLY; then
  exit 0
fi

# --- 3. Environnement local -------------------------------------------------
if [ -f "$LOCAL_DIR/env.sh" ]; then
  # set -a exporte toutes les variables définies dans env.sh vers le processus PocketBase.
  set -a
  # shellcheck disable=SC1091
  source "$LOCAL_DIR/env.sh"
  set +a
  echo "Environnement chargé depuis ${LOCAL_DIR}/env.sh."
fi

PB_PORT="${PB_PORT:-8090}"
# Le serveur MCP appelle l'API en boucle locale : aligner son adresse sur le port choisi.
export WECAIRN_INTERNAL_URL="${WECAIRN_INTERNAL_URL:-http://127.0.0.1:${PB_PORT}}"
mkdir -p "$PB_DATA_DIR"

# --- 4. Superutilisateur ----------------------------------------------------
if [ -n "${PB_ADMIN_EMAIL:-}" ] && [ -n "${PB_ADMIN_PASSWORD:-}" ]; then
  echo "Création ou mise à jour du superutilisateur ${PB_ADMIN_EMAIL}..."
  "$PB_BIN" superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir "$PB_DATA_DIR" --migrationsDir pocketbase/pb_migrations >/dev/null
fi

# --- 5. Lancement -----------------------------------------------------------
SERVE_ARGS=(serve
  --http "127.0.0.1:${PB_PORT}"
  --dir "$PB_DATA_DIR"
  --hooksDir pocketbase/pb_hooks
  --migrationsDir pocketbase/pb_migrations
  --publicDir web)

print_urls() {
  echo
  echo "WeCairn (PocketBase ${PB_VERSION})"
  echo "  Interface      : http://127.0.0.1:${PB_PORT}/"
  echo "  Console admin  : http://127.0.0.1:${PB_PORT}/_/"
  echo "  API            : http://127.0.0.1:${PB_PORT}/api/"
  echo "  Santé          : http://127.0.0.1:${PB_PORT}/api/health"
  echo "  MCP            : http://127.0.0.1:${PB_PORT}/mcp"
  echo "  Données        : ${PB_DATA_DIR}"
  echo
}

if $BACKGROUND; then
  # Arrêt d'une éventuelle instance précédente lancée par ce script.
  pkill -f "$PB_BIN serve" 2>/dev/null || true
  sleep 1
  nohup "$PB_BIN" "${SERVE_ARGS[@]}" > "$PB_LOG" 2>&1 &
  echo "Serveur lancé en arrière-plan (PID $!), journal : ${PB_LOG}"
  sleep 2
  tail -n 3 "$PB_LOG" || true
  print_urls
  echo "Arrêt : pkill -f '${PB_BIN} serve'"
else
  print_urls
  exec "$PB_BIN" "${SERVE_ARGS[@]}"
fi
