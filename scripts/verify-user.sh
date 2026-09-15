#!/usr/bin/env bash
# =============================================================================
# WeCairn : marquer un compte membre comme vérifié (développement local)
# =============================================================================
# À partir de la phase 2, les membres ne peuvent se connecter qu'une fois leur
# adresse confirmée (authRule « verified = true » de la collection users). En local,
# sans SMTP ni Brevo, l'e-mail de confirmation ne part pas : ce script marque le compte
# comme vérifié via l'API, avec le superutilisateur de .local/env.sh.
#
# Usage : scripts/verify-user.sh prenom@entreprise.fr   (ou make verify-user EMAIL=...)
#
# Variables : PB_URL (défaut http://127.0.0.1:8090), PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD
# Dépendances : curl et node (pas de jq).
# =============================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

EMAIL="${1:-${EMAIL:-}}"
if [ -z "$EMAIL" ]; then
  echo "Usage : scripts/verify-user.sh <e-mail du membre>" >&2
  exit 1
fi

if [ -f .local/env.sh ]; then
  set -a
  # shellcheck disable=SC1091
  source .local/env.sh
  set +a
fi
PB_URL="${PB_URL:-http://127.0.0.1:8090}"
if [ -z "${PB_ADMIN_EMAIL:-}" ] || [ -z "${PB_ADMIN_PASSWORD:-}" ]; then
  echo "PB_ADMIN_EMAIL et PB_ADMIN_PASSWORD sont requis (dans .local/env.sh ou l'environnement)." >&2
  exit 1
fi

json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=eval("(o)=>"+process.argv[1])(JSON.parse(s));process.stdout.write(v==null?"":String(v))})' "$1"; }

TOKEN="$(curl -fsS -X POST "${PB_URL}/api/collections/_superusers/auth-with-password" \
  -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({identity:process.argv[1],password:process.argv[2]}))' "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD")" \
  | json 'o.token')"

FILTER="$(node -e 'console.log(encodeURIComponent(`email = "${process.argv[1].replace(/["\\]/g, "")}"`))' "$EMAIL")"
ID="$(curl -fsS "${PB_URL}/api/collections/users/records?filter=${FILTER}&perPage=1" -H "Authorization: ${TOKEN}" | json 'o.items[0] && o.items[0].id')"
if [ -z "$ID" ]; then
  echo "Aucun membre avec l'adresse ${EMAIL}." >&2
  exit 1
fi

curl -fsS -X PATCH "${PB_URL}/api/collections/users/records/${ID}" \
  -H "Authorization: ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"verified":true}' >/dev/null
echo "Compte ${EMAIL} marqué comme vérifié."
