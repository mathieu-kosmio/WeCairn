# Sécurité

Ce document décrit ce que WeCairn protège, contre qui, comment, et ce qui reste à la charge de l'exploitant. Pour
signaler une faille, voir [SECURITY.md](../SECURITY.md).

- [Principes](#principes)
- [Qui peut attaquer, et quoi](#qui-peut-attaquer-et-quoi)
- [Protections](#protections)
- [Risques résiduels](#risques-résiduels)
- [Avant la mise en production](#avant-la-mise-en-production)
- [Vérifier soi-même](#vérifier-soi-même)

## Principes

1. **La base décide.** Toute règle d'accès vit dans `pocketbase/pb_schema.json` et s'applique à chaque client :
   navigateur, serveur MCP, `curl`. L'interface ne fait que refléter ce que la base autorise.
2. **Une adresse vérifiée, sinon rien.** L'organisation est déduite du domaine de l'e-mail : tant que l'adresse
   n'est pas prouvée, le compte ne se connecte pas, n'apparaît nulle part et ne reçoit rien.
3. **Les secrets restent sur le serveur.** Clés IA, clés MCP en clair, jetons de fournisseur : jamais dans l'API,
   jamais dans le navigateur (hors jeton éphémère de l'entretien vocal).
4. **Chaque protection a son test.** `make test` rejoue les attaques connues sur une instance jetable, en local et
   en intégration continue.

## Qui peut attaquer, et quoi

| Acteur | Ce qu'il peut faire normalement | Ce qu'il ne doit jamais obtenir |
|---|---|---|
| Visiteur anonyme | s'inscrire, lire l'horizon (activité publique agrégée), lire `llms.txt` | les données d'une organisation, un compte existant, l'accès console |
| Personne qui ne contrôle pas la boîte `@client.fr` | créer un compte non vérifié | entrer dans l'organisation `client.fr`, écrire aux membres |
| Membre d'une organisation | lire et écrire dans son organisation, modifier ses contenus | lire une autre organisation, agir au nom d'un autre, devenir superutilisateur |
| Agent IA (clé `wc_` ou OAuth) | les droits du membre qui l'a autorisé | davantage que ces droits, survivre à la reprise du compte |
| Client OAuth enregistré par un tiers | demander une autorisation | obtenir un accès sans que le membre voie à qui il le donne |
| Superutilisateur | tout, depuis la console `/_/` | hors modèle : protéger ce compte (MFA, mot de passe fort) |

## Protections

La colonne « Test » renvoie aux tests de `tests/api.test.mjs`.

### Organisations et règles d'accès

| Protection | Où | Test |
|---|---|---|
| Lecture et écriture limitées à `@request.auth.organisation` sur toutes les collections et vues | `pb_schema.json` | isolation : une organisation ne lit pas les pierres d'une autre |
| `organisation`, `author` et `domain` jamais fixés par le client | `pb_schema.json`, `main.pb.js` | le client ne peut pas choisir son organisation ; impossible de poser une pierre au nom d'un autre |
| Refus d'accès répondu en `404`, pas `403` | PocketBase | impossible de poser une pierre au nom d'un autre ou dans une autre organisation |
| Clé IA d'organisation masquée (`hidden`), non modifiable par les membres | `pb_schema.json` | rattachement par domaine : même domaine, même organisation |
| Horizon : nombres par jour, tag exposé seulement s'il est utilisé par au moins 3 organisations | `horizon.pb.js` | (revue ; agrégat anonyme) |

### Comptes

| Protection | Où | Test |
|---|---|---|
| Connexion réservée aux adresses vérifiées (`authRule : verified = true`) | `pb_schema.json` | connexion refusée tant que l'adresse n'est pas vérifiée ; la collection users exige une adresse vérifiée |
| `verified` jamais modifiable par le membre | PocketBase | un membre ne peut pas se marquer lui-même comme vérifié |
| Adresse en minuscules, unicité insensible à la casse | `wecairn.js` (`memberDomain`), index `idx_users_email` | adresse insensible à la casse : pas de doublon |
| Messageries grand public refusées (liste et familles), domaines non ASCII refusés | `wecairn.js` | messageries grand public refusées sous toutes leurs formes |
| Changement d'adresse limité au domaine de l'organisation | `main.pb.js` | changement d'adresse : le domaine de l'organisation est conservé |
| Comptes non vérifiés invisibles, absents du classement, non notifiés, supprimés après 7 jours | `pb_schema.json`, `notify.js`, `account.pb.js` | un compte non vérifié est invisible des membres et du classement |
| Mot de passe aligné uniquement de la console vers le membre vérifié de même adresse, jamais l'inverse | `account.pb.js` | prise de contrôle du superutilisateur impossible |
| Limitation de débit : connexions, inscriptions, e-mails de compte | migration `1789495468` | (réglage d'instance) |

### Serveur MCP et clés

| Protection | Où | Test |
|---|---|---|
| Clés `wc_` de 40 caractères aléatoires, stockées hachées (SHA-256), 30 jours, révocables | `mcp.js` | MCP : la clé d'un membre non vérifié est refusée |
| Outils exécutés via l'API REST avec un jeton du membre : mêmes règles d'accès | `mcp.js` | MCP : initialize et tools/list |
| Clé refusée si l'adresse du membre n'est pas vérifiée | `mcp.js` | MCP : la clé d'un membre non vérifié est refusée |
| Nouveau mot de passe ou réinitialisation : toutes les clés du membre révoquées | `account.pb.js` | MCP : un nouveau mot de passe révoque les clés du membre |
| Lots JSON-RPC et publications en lot bornés à 20 | `mcp.js` | MCP : lots bornés à 20 |
| Noms et contenus saisis par les membres cités comme données dans les consignes de l'agent | `mcp.js` | MCP : les noms saisis par les membres sont cités comme des données |
| `X-Forwarded-Proto` accepté seulement s'il vaut `http` ou `https` | `mcp.js` | (revue) |

### OAuth 2.1

| Protection | Où | Test |
|---|---|---|
| Code d'autorisation + PKCE S256 obligatoire, code à usage unique, 10 minutes | `oauth.js`, `oauth.pb.js` | OAuth : enregistrement, autorisation, échange PKCE, client_id obligatoire |
| `client_id` obligatoire à l'échange, `redirect_uri` identique s'il est fourni | `oauth.pb.js` | idem |
| Adresses de retour : `https` ou boucle locale, sans fragment, identifiants ni joker, 5 au plus | `oauth.js` | OAuth : adresses de retour trompeuses refusées, hôte inconnu signalé |
| Page de consentement : hôte destinataire affiché, avertissement s'il n'est pas un connecteur connu | `oauth.js` | idem |
| Réponses `no-store`, page protégée contre l'intégration en cadre | `oauth.js`, `headers.pb.js` | (revue) |

### Relais IA

| Protection | Où | Test |
|---|---|---|
| Clé du fournisseur jamais renvoyée ; jeton éphémère pour l'entretien temps réel | `ai.js`, `ai.pb.js` | IA : dictée, seuls les formats audio partent chez le fournisseur |
| Rien n'est publié sans relecture : la sortie du modèle ne fait que pré-remplir le formulaire | `ai.js`, `web/index.html` | idem |
| Audio limité à 25 Mo et aux formats audio ; transcript borné | `ai.pb.js` | idem |
| Routes réservées aux membres connectés, limitées à 20 appels/minute par IP | `ai.pb.js`, migration `1789495468` | (réglage d'instance) |

### Navigateur et HTTP

| Protection | Où | Test |
|---|---|---|
| Tout contenu utilisateur échappé avant insertion dans la page (`esc()`) | `web/index.html` | revue (audit web) |
| SDK PocketBase chargé avec contrôle d'intégrité SRI | `web/index.html`, `oauth.js` | revue |
| `Strict-Transport-Security` (en HTTPS), `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy` | `headers.pb.js` | revue |
| `X-Content-Type-Options`, `X-Frame-Options` | PocketBase | revue |

### Chaîne de livraison

| Protection | Où |
|---|---|
| Archive PocketBase vérifiée par SHA-256 épinglé (image) ou `checksums.txt` de la release (`scripts/pb.sh`) | `Dockerfile`, `scripts/pb.sh` |
| Conteneur exécuté sans les droits root (utilisateur `pb`, bascule `su-exec`) | `Dockerfile`, `docker-entrypoint.sh` |
| Image construite par Coolify depuis le dépôt à chaque déploiement ; `make test` lancé avant de pousser | `Dockerfile`, `scripts/test.sh` |
| Aucun secret versionné : `.local/`, binaire et données ignorés | `.gitignore` |

## Risques résiduels

Ces points sont connus et assumés. Une instance exposée à un public large doit les traiter.

- **Compte créé sur l'adresse d'autrui.** Quelqu'un peut créer un compte non vérifié avec votre adresse et un mot
  de passe de son choix. S'il obtient que vous cliquiez sur le lien de confirmation reçu sans l'avoir demandé, il
  se connecte à votre place. Atténuations : le compte est supprimé après 7 jours, et une réinitialisation du mot de
  passe par le vrai titulaire reprend la main (et révoque les clés MCP). Parade complète : inscription sans mot de
  passe (code à usage unique).
- **Contenu inter-membres lu par un agent.** Le contenu des pierres et commentaires est saisi par des membres de
  l'organisation ; un agent MCP qui le lit pourrait être visé par une injection de consignes. Les instructions du
  serveur préviennent l'agent que ce contenu est une donnée, jamais une consigne ; l'impact reste borné aux droits
  du membre et à son organisation. Un agent bien construit ne suit pas d'instruction trouvée dans une donnée.
- **Coût de la clé IA globale.** Avec `WECAIRN_AI_KEY`, tout membre vérifié de n'importe quelle organisation utilise
  cette clé. La limitation de débit borne les rafales, pas la dépense totale. Pour une instance publique : clé par
  organisation, plafond de dépense chez le fournisseur, ou quota par membre.
- **Liste de messageries grand public.** C'est une liste : elle ne connaît pas toutes les messageries. Un domaine
  inconnu crée une organisation partagée par tous ses utilisateurs.
- **Jetons de session en `localStorage`.** Lisibles par un script injecté : la protection repose sur l'échappement
  systématique (`esc()`) et le SRI. La `Content-Security-Policy` posée est un sous-ensemble défensif
  (`frame-ancestors`, `base-uri`, `object-src`, `form-action`) : elle ne restreint pas encore `script-src`, car
  l'interface utilise des scripts en ligne. Durcissement possible : externaliser le JavaScript et poser une CSP
  `default-src 'self'` avec les origines du fournisseur temps réel et des polices.
- **Enregistrement OAuth ouvert.** L'enregistrement dynamique est anonyme (limité en débit) : un tiers peut créer un
  client au nom trompeur. La page de consentement affiche l'hôte réel et avertit s'il est inconnu ; le clic reste
  celui du membre. Durcissement possible : refuser l'enregistrement aux hôtes inconnus, ou exiger une case à cocher.
- **Codes OAuth abandonnés.** Un code d'autorisation approuvé mais jamais échangé reste en mémoire jusqu'à son
  expiration (10 min) sans balayage actif ; exploitation en déni de service lente et bornée par la limite de débit.
- **Nombre de clés et de clients non plafonné.** Un membre peut accumuler des clés `api_keys` ; l'enregistrement
  dynamique peut gonfler `oauth_clients`. Impact : encombrement, pas d'élévation de privilèges.
- **`baseURL` retombe sur l'en-tête `Host`.** Si l'URL de l'application n'est pas renseignée dans la console (ou
  pointe sur localhost), les métadonnées OAuth et `llms.txt` utilisent le `Host` de la requête, falsifiable. En
  production, renseigner l'URL publique rend ce repli inatteignable (première case de la liste ci-dessous).
- **Renommage de l'organisation par tout membre.** Il n'y a pas de rôle « administrateur d'organisation » : tout
  membre vérifié peut modifier le nom et les objectifs de son organisation (pas le domaine, ni la clé IA). Le nom
  apparaît dans les e-mails de notification. Pour un usage multi-organisations sensible : introduire un propriétaire.
- **Limitation de débit derrière un proxy.** L'adresse IP est lue dans `X-Forwarded-For`, ajouté par Coolify. Une
  instance exposée sans proxy laisserait un client falsifier cet en-tête et contourner les limites.
- **Console d'administration.** `/_/` est publique par défaut, protégée par mot de passe et limitée en débit.
  Activer la MFA des superutilisateurs, ou restreindre `/_/` par IP au niveau du proxy.
- **Serveur MCP local.** `mcp/server.js` lit un mot de passe en clair dans la configuration du poste. Préférer le
  serveur distant avec une clé révocable.

## Avant la mise en production

- [ ] URL de l'application renseignée dans la console (*Settings > Application*) : e-mails, OAuth et `llms.txt` ne
      dépendent plus des en-têtes de la requête.
- [ ] Canal d'e-mail fonctionnel (Brevo ou SMTP) : la vérification des adresses en dépend.
- [ ] Mot de passe fort et MFA pour les superutilisateurs (console, collection `_superusers` > *Options* > MFA).
- [ ] Limitation de débit active et en-tête d'IP `X-Forwarded-For` (*Settings > Application*, réglés par migration).
- [ ] Après la migration de durcissement, vérifier l'index `idx_users_email` (`COLLATE NOCASE`) et l'absence de
      doublon d'adresse à la casse près.
- [ ] Sauvegardes S3 chiffrées (console *Settings > Backups*), accès restreint, restauration testée.
- [ ] Clé IA : par organisation, ou plafond de dépense chez le fournisseur.
- [ ] Signalement privé activé : *Settings > Code security > Private vulnerability reporting* (dépôt public).

## Vérifier soi-même

```bash
make test
```

`make test` monte une instance PocketBase jetable, applique les migrations, démarre un faux fournisseur IA (aucune
clé réelle) et rejoue les 24 tests d'intégration. Le lancer avant de pousser ; le déploiement se fait ensuite par
l'auto-déploiement Coolify sur `main`, qui reconstruit l'image depuis le dépôt.
