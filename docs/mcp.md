# Connecter un agent IA (serveur MCP)

WeCairn expose un serveur MCP sur le même domaine que l'application : un agent (Claude, Cursor, ChatGPT ou tout client
MCP) peut retrouver ce que l'équipe a appris, poser une pierre au fil d'une conversation, extraire les retex d'un compte
rendu de réunion, caler ou commenter. Il agit avec le compte de l'utilisateur, donc avec ses droits : il ne voit et
n'écrit que dans son organisation, et ne modifie que ses propres pierres.

## Pour l'utilisateur : trois gestes

1. Donner l'adresse du site à son agent, par exemple « Connecte-toi à https://wecairn.exemple.fr ».
2. L'agent découvre le serveur MCP et demande une clé. Dans WeCairn, menu utilisateur > **Connecter un agent IA (MCP)**
   > **Générer une clé** : la clé (`wc_…`) s'affiche une seule fois ; elle vaut 30 jours et se révoque au même endroit.
3. Coller la clé dans la conversation. L'agent se connecte et présente ce qu'il peut faire.

Rien à installer, aucune configuration à éditer, aucun mot de passe transmis.

## Pour l'agent : découverte

| Adresse | Contenu |
|---|---|
| `/llms.txt` | Mode d'emploi en clair : adresse du serveur, obtention de la clé, configuration, outils |
| `/.well-known/mcp.json` | La même chose, lisible par machine |
| `GET /mcp` | Description JSON (405 si un flux SSE est demandé) |
| `POST /mcp` sans clé | 401 avec les instructions pour obtenir une clé |

La page d'accueil porte aussi `<meta name="mcp-server" content="/mcp">` et un lien vers `llms.txt`.

## Protocole et authentification

- MCP **Streamable HTTP**, sans état : requêtes JSON-RPC en `POST /mcp` (messages ou lots), réponses JSON, `202` pour
  les notifications. Pas de session ni de flux SSE. Versions de protocole : 2025-06-18, 2025-03-26, 2024-11-05.
- En-tête `Authorization: Bearer wc_…`. La clé est stockée hachée (SHA-256), avec un préfixe pour la reconnaître,
  une date d'expiration et la date de dernière utilisation.
- À l'initialisation, le serveur renvoie des `instructions` : ce qu'est WeCairn, les outils, les bonnes pratiques, et
  la consigne de présenter les options à l'utilisateur.
- Chaque outil appelle l'API REST de PocketBase en boucle locale avec un jeton de l'utilisateur (`WECAIRN_INTERNAL_URL`,
  `http://127.0.0.1:8090` par défaut) : les règles d'accès des collections s'appliquent telles quelles.

Configuration côté client :

```bash
claude mcp add --transport http wecairn https://wecairn.exemple.fr/mcp --header "Authorization: Bearer wc_…"
```

Autres clients : URL `https://wecairn.exemple.fr/mcp`, transport Streamable HTTP, en-tête `Authorization`.

## Outils

| Outil | Rôle |
|---|---|
| `list_retex` | Lister les retex (tri par tendance, date ou votes, filtre par tag) |
| `search_retex` | Chercher par mots-clés dans le titre, la situation, l'enseignement, la bonne pratique et les tags |
| `get_retex` | Lire un retex complet avec ses commentaires |
| `create_retex` | Poser une pierre au nom de l'utilisateur (+10 points) |
| `create_retex_batch` | Poser plusieurs pierres d'un coup, après validation par l'utilisateur |
| `update_retex` | Modifier un de ses retex (champs omis conservés) |
| `delete_retex` | Supprimer un de ses retex, après confirmation |
| `vote_retex` | Caler une pierre (vote « utile ») ou retirer son calage |
| `comment_retex` | Commenter |
| `leaderboard` | La cordée : points et niveaux de l'équipe |

Prompt : `extraire_retex` prend une transcription ou un compte rendu, propose des retex structurés, demande validation,
puis publie en lot avec `source = transcript`.

## Exemples

- « Est-ce que l'équipe a déjà un retex sur les ateliers de cadrage données ? »
- « Pose une pierre : on a perdu deux jours parce que… »
- « Voici la transcription de la réunion de lancement, extrais-en les retex. »
- « Corrige le titre de mon retex d'hier, il manque le mot client. »

## Bonnes pratiques pour l'agent

Les descriptions des outils et les instructions d'initialisation guident déjà le modèle : chercher avant de publier
pour éviter les doublons, préférer un calage ou un commentaire si un retex proche existe, présenter la liste avant une
publication en lot, confirmer avant une suppression. Le serveur ne contourne aucune règle d'accès ; un retex d'un autre
membre est en lecture seule.

## Serveur local (stdio), en option

`mcp/server.js` reste disponible pour un client qui ne parle pas HTTP : mêmes outils, connexion par e-mail et mot de
passe (`WECAIRN_URL`, `WECAIRN_EMAIL`, `WECAIRN_PASSWORD`), `cd mcp && npm install`, puis `node mcp/server.js` déclaré
en commande dans le client. Le mot de passe est alors en clair dans la configuration du poste : préférer le serveur
distant dès que possible.
