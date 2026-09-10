# Déploiement

## Coolify (recommandé)

1. Pousser le dépôt sur GitHub (privé ou public).
2. Dans Coolify : **+ New Resource > Docker Compose**, source Git, ce dépôt, branche `main`. Coolify lit
   `docker-compose.yaml` et construit l'image depuis le `Dockerfile`.
3. Assigner un domaine au service `wecairn` (par exemple `https://wecairn.exemple.fr`, port 8090). Coolify gère le
   certificat et le reverse proxy : le compose n'expose aucun port et n'embarque pas de Traefik.
4. Déployer, puis créer le superutilisateur. Depuis PocketBase 0.23, `/_/` affiche directement un formulaire de
   connexion sur une instance vierge (il n'y a pas de formulaire de création) ; deux façons de faire :
   - **Terminal du conteneur** (Coolify : ressource > *Terminal*) :
     `/pb/pocketbase superuser upsert vous@exemple.fr 'un-mot-de-passe-solide' --dir /pb/pb_data`
   - **Lien d'installation** : dans les *Logs* du conteneur, au premier démarrage, PocketBase imprime une URL
     `…/_/#/pbinstal/<jeton>` ; remplacer `0.0.0.0:8090` par le domaine public et l'ouvrir.
5. **Settings > Import collections** : charger `pocketbase/pb_schema.json`, **activer « Merge with the existing
   collections »** (sinon l'import supprime les collections système, dont `_superusers`), puis *Review* et *Confirm*.
   Une seule fois ; ensuite les collections vivent dans le volume `wecairn_data`. Si l'interface répond « Failed to
   import collections », passer par l'API, qui prend le fichier tel quel :
   ```bash
   TOKEN=$(curl -s -X POST https://wecairn.exemple.fr/api/collections/_superusers/auth-with-password \
     -H 'Content-Type: application/json' -d '{"identity":"vous@exemple.fr","password":"..."}' | jq -r .token)
   jq '{collections: ., deleteMissing: false}' pocketbase/pb_schema.json | \
     curl -s -X PUT https://wecairn.exemple.fr/api/collections/import -H "Authorization: $TOKEN" \
     -H 'Content-Type: application/json' --data @-
   ```
6. **Settings > Mail settings** : renseigner un SMTP (Brevo ou autre) pour la réinitialisation de mot de passe.
   Sans SMTP, tout fonctionne sauf « Mot de passe oublié ».
7. **Settings > Backups** : activer les sauvegardes automatiques vers un S3 (Garage ou MinIO sur le même Coolify,
   ou un fournisseur). Le volume est le seul endroit où vivent les données.
8. **Settings > Application** : renseigner l'URL publique (utilisée dans les e-mails).
9. Partage vocal (optionnel) : variables `WECAIRN_AI_PROVIDER` et `WECAIRN_AI_KEY` cochées « secret », ou clé par
   organisation depuis la console (voir [ia-vocale.md](ia-vocale.md)).

L'interface est servie à la racine du domaine, l'API sous `/api/`, la console sous `/_/`.

Mise à jour : `git push`, puis redéployer dans Coolify. Réimporter le schéma uniquement s'il a changé (« delete
missing » décoché).

## Docker sans Coolify

```bash
docker compose up -d --build
```

Le service écoute sur le port 8090 du conteneur ; placer un reverse proxy avec TLS devant (Caddy, Traefik, nginx).
Le micro et l'entretien vocal exigent HTTPS.

## Sans Docker

Télécharger le binaire PocketBase pour votre système, puis :

```bash
./pocketbase serve --http 0.0.0.0:8090 --dir pb_data --hooksDir pocketbase/pb_hooks --publicDir web
```

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `WECAIRN_AI_PROVIDER` | `mistral` (dictée) ou `openai` (entretien temps réel), configuration globale |
| `WECAIRN_AI_KEY` | clé du fournisseur, configuration globale |
| `WECAIRN_AI_BASE_URL` | endpoint compatible (optionnel) |
| `WECAIRN_AI_STT_MODEL`, `WECAIRN_AI_CHAT_MODEL`, `WECAIRN_AI_REALTIME_MODEL`, `WECAIRN_AI_VOICE` | modèles et voix (optionnel) |

L'ancien préfixe `WERETEX_` reste accepté. Une clé renseignée sur l'organisation dans la console a priorité sur ces
variables. PocketBase recharge les hooks à chaud mais hérite de l'environnement du processus : après un changement de
variable, redémarrer le service.

## Sauvegarde et restauration

Les sauvegardes PocketBase (console, **Settings > Backups**) contiennent la base et les fichiers. Pour restaurer :
choisir la sauvegarde dans la console et cliquer sur « Restore », ou remplacer le contenu du volume par celui de
l'archive, service arrêté.

## Dimensionnement

512 Mo de mémoire suffisent largement (limite posée dans le compose). Une instance SQLite encaisse plusieurs milliers
de retex et des dizaines d'organisations. Au-delà, ou si Postgres est imposé, voir [architecture.md](architecture.md).
