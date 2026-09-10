# Contribuer à WeCairn

Merci de vous intéresser au projet. Voici comment il est organisé et comment proposer un changement.

## Esprit du projet

WeCairn cherche la simplicité maximale : un binaire, un fichier HTML, pas d'étape de build, pas de framework côté
navigateur. Avant d'ajouter une dépendance ou une couche, vérifier qu'elle apporte plus qu'elle ne coûte à quelqu'un
qui découvre le dépôt. Le vocabulaire de l'interface est en français ; le code et les commentaires aussi, sauf les
identifiants techniques.

Trois règles de fond, à ne pas changer sans discussion préalable dans une issue :

- l'isolation entre organisations repose sur les règles d'accès de `pb_schema.json`, jamais sur l'interface ;
- le barème de progression (10 / 2 / 1 / 3 points, cinq niveaux) est le même partout (vue SQL, interface, MCP) ;
- aucune donnée nominative ni aucun texte de retex ne sort de l'organisation, y compris sur la page d'accueil.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `web/index.html` | Interface complète : styles, balisage, logique. Les jetons de design sont en tête du fichier. |
| `pocketbase/pb_schema.json` | Collections, vues, règles d'accès. À importer dans la console après modification. |
| `pocketbase/pb_hooks/*.pb.js` | Hooks exécutés par PocketBase. Chaque handler tourne dans une VM isolée : la logique partagée vit dans les modules `*.js` chargés par `require()`. |
| `mcp/server.js` | Serveur MCP (Node, stdio). |
| `docs/` | Documentation. |

## Lancer en local

```bash
./pocketbase serve --hooksDir pocketbase/pb_hooks --publicDir web
```

Créer le superutilisateur sur `/_/`, importer `pocketbase/pb_schema.json`, puis ouvrir `/`. Les hooks se rechargent
à chaud ; un changement de variable d'environnement demande un redémarrage.

## Tests

Le projet se teste contre une instance PocketBase jetable. La méthode utilisée pendant le développement :

1. Réinitialiser une base (`pb_data` vide), créer un superutilisateur, importer le schéma par `PUT /api/collections/import`.
2. **API** : scripts Python sans dépendance (`urllib`) qui créent trois comptes sur deux organisations et vérifient
   chaque règle d'accès (lecture, création, vote unique, modification et suppression réservées à l'auteur, isolation).
3. **Interface** : Playwright avec le Chromium local, en simulant le micro (`MediaRecorder`, `getUserMedia`,
   `RTCPeerConnection`) pour les parcours vocaux, et un faux fournisseur IA HTTP pour ne jamais dépendre d'une clé.
4. **Accessibilité** : axe-core sur chaque écran dans les deux thèmes, plus un parcours clavier scripté.

Une contribution qui touche aux règles d'accès ou au barème doit venir avec le test correspondant.

## Conventions

- Pas de build : tout ce qui est dans `web/` doit s'ouvrir tel quel.
- Couleurs et espacements passent par les jetons CSS (`--ink`, `--accent-text`, `--line-strong`…), jamais en dur.
- Contrastes : 4,5:1 pour le texte, 3:1 pour les composants, dans les deux thèmes.
- Toute action a un état accessible (`aria-pressed`, `aria-expanded`, libellé explicite) et un retour visible.
- Animations en sortie exponentielle, sans rebond, désactivées avec `prefers-reduced-motion`.
- Pas de tiret cadratin dans les textes.

## Proposer un changement

1. Ouvrir une issue pour décrire le besoin ou le problème, avec le contexte d'usage.
2. Créer une branche, faire le changement, ajouter ou adapter les tests.
3. Ouvrir une pull request avec une description courte : quoi, pourquoi, comment c'est vérifié.

Les retours d'usage (ce qui marche, ce qui bloque, le vocabulaire qui sonne faux) sont aussi utiles que le code.
