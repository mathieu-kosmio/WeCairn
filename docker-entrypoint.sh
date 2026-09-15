#!/bin/sh
# WeCairn : démarre en root le temps de s'assurer que le volume de données appartient à l'utilisateur
# non privilégié « pb », puis abandonne les privilèges (su-exec) pour lancer PocketBase sans être root.
# Compatible avec un volume existant créé par une version antérieure qui tournait en root : le chown le réaligne.
set -e

if [ "$(id -u)" = "0" ]; then
  mkdir -p /pb/pb_data
  chown -R pb:pb /pb/pb_data
  exec su-exec pb "$@"
fi

exec "$@"
