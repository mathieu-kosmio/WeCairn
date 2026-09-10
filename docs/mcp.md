# Connecter Claude (serveur MCP)

Le serveur MCP permet de lire et d'alimenter WeCairn depuis une conversation Claude : poser une pierre au fil d'une
discussion, retrouver un retex existant, extraire les enseignements d'un compte rendu de réunion. Il se connecte avec
le compte de l'utilisateur, donc avec ses droits : il ne voit et n'écrit que dans son organisation.

## Installation sur le poste

```bash
cd mcp && npm install
```

Dans Claude Desktop (`claude_desktop_config.json`) ou Claude Code (`claude mcp add-json wecairn '…'`) :

```json
{
  "mcpServers": {
    "wecairn": {
      "command": "node",
      "args": ["/chemin/vers/wecairn/mcp/server.js"],
      "env": {
        "WECAIRN_URL": "https://wecairn.exemple.fr",
        "WECAIRN_EMAIL": "prenom@entreprise.fr",
        "WECAIRN_PASSWORD": "le mot de passe du compte WeCairn"
      }
    }
  }
}
```

L'interface fournit cette configuration prête à copier (menu utilisateur, « Connecter Claude (MCP) »). L'ancien
préfixe `WERETEX_` reste accepté.

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

## Bonnes pratiques pour Claude

Les descriptions des outils guident déjà le modèle : chercher avant de publier pour éviter les doublons, préférer un
vote ou un commentaire si un retex proche existe, présenter la liste avant une publication en lot, confirmer avant une
suppression. Le serveur ne contourne aucune règle d'accès ; un retex d'un autre membre est en lecture seule.

## Serveur distant

Pour éviter la configuration par poste, une piste est un serveur MCP en HTTP (Streamable HTTP) derrière le même domaine,
avec l'authentification PocketBase. Ce n'est pas encore fait ; les contributions sont bienvenues.
