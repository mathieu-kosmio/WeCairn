# Modèle de données

Tout est défini dans `pocketbase/pb_schema.json`, importable depuis la console (**Settings > Import collections**).

## Collections

**organisations** : `name` (affiché, modifiable par les membres), `domain` (unique, déduit de l'e-mail, verrouillé),
`objectives` (texte, un objectif par ligne, cinq au plus, modifiable par les membres), `ai_provider` (`openai` ou
`mistral`) et `ai_api_key` (champ masqué, jamais renvoyé par l'API, réglable depuis la console uniquement).

**users** (auth) : `name`, `email` (visibilité désactivée pour les autres membres), `organisation` (relation, posée par le
hook, jamais par le client).

**retex** : `organisation`, `author`, `title` (l'enseignement en une phrase, 5 à 140 caractères), `situation`,
`learning`, `recommendation` (optionnel), `tags` (JSON, minuscules, dédoublonnés, 8 au plus, normalisés par le hook),
`source` (`manual`, `mcp`, `transcript`), `source_ref`.

**votes** : `retex`, `user`. Index unique sur le couple : une personne ne cale une pierre qu'une fois.

**comments** : `retex`, `author`, `body`.

## Vues SQL

**retex_feed** joint le retex, le nom de l'auteur, le nombre de votes et de commentaires. C'est ce que lit le fil.

**leaderboard** calcule par membre : pierres posées, calages reçus, calages donnés, commentaires, et le total de points.
Le barème est dans la requête de la vue et repris tel quel dans l'interface et le MCP :

| Action | Points |
|---|---|
| Poser une pierre (publier un retex) | 10 |
| Recevoir un calage (vote « utile ») | 2 |
| Donner un calage | 1 |
| Écrire un commentaire | 3 |

Niveaux : Observateur (0), Contributeur (20), Passeur (60), Mentor (150), Pilier (400). L'interface affiche aussi une
altitude, dix mètres par point, et des badges calculés côté client (première pierre, 5 et 20 pierres, utile x10 et x50,
bon public, discutant). Le score « tendance » du fil (votes pondérés par l'ancienneté) est calculé côté client.

## Règles d'accès

| Collection | Lecture | Création | Modification | Suppression |
|---|---|---|---|---|
| organisations | sa propre organisation | interdite | membres, champs `name` et `objectives` seulement | interdite |
| users | membres de son organisation (e-mail masqué) | inscription, sans champ `organisation` | soi-même, sans changer d'organisation | interdite |
| retex | son organisation | au nom de soi-même, dans son organisation | auteur | auteur |
| votes | son organisation | au nom de soi-même | interdite | auteur du vote |
| comments | son organisation | au nom de soi-même | auteur | auteur |
| retex_feed, leaderboard | son organisation | vues | vues | vues |

Quand une règle refuse une modification, PocketBase répond `404` (l'enregistrement est « introuvable » pour cet
utilisateur), pas `403`.

## Faire évoluer le schéma

Modifier `pb_schema.json`, puis réimporter dans la console avec « delete missing » décoché. Les identifiants de
collections doivent rester stables : ils sont référencés par les relations et par les données existantes.
