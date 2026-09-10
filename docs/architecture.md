# Architecture

## Vue d'ensemble

```
navigateur ── web/index.html ──┐
                               ├── PocketBase (un binaire, SQLite) ── pb_hooks/ ── fournisseur IA (optionnel)
Claude ── mcp/server.js ───────┘        │
                                        └── volume pb_data (données, fichiers, sauvegardes)
```

Un seul processus sert l'interface (fichiers statiques), l'API REST, le temps réel, la console d'administration et
les routes ajoutées par les hooks. Le serveur MCP est un petit programme Node lancé sur le poste de l'utilisateur ;
il parle à l'API comme le navigateur, avec le compte de l'utilisateur.

## Pourquoi PocketBase

Le produit vise plusieurs organisations, un vote et un classement partagés en temps réel, et un accès MCP au nom de
chaque utilisateur. PocketBase couvre tout cela dans un binaire Go d'une cinquantaine de mégaoctets de mémoire vive :
authentification, règles d'accès par enregistrement, API REST, abonnements temps réel, fichiers, console, sauvegardes
S3. Une pile équivalente auto-hébergée sur Supabase demande une douzaine de conteneurs.

Limite assumée : SQLite, donc une seule instance, qui monte en gamme verticalement. Pour une poignée d'organisations
et quelques milliers de retex, le plafond est très loin. Si un client impose Postgres ou de la haute disponibilité,
Directus reprend le même modèle ; l'interface et le MCP ne changent que leur client HTTP.

## Isolation multi-organisation

À l'inscription, le hook `users` (`pb_hooks/main.pb.js`) rattache l'utilisateur à l'organisation correspondant au
domaine de son e-mail, en la créant si besoin. Les domaines de messageries grand public sont refusés (liste dans
`pb_hooks/wecairn.js`). Le client ne peut ni choisir ni changer son organisation : la `createRule` de `users`
interdit le champ, et la `updateRule` aussi.

Toutes les règles d'accès vivent dans `pb_schema.json` et référencent `@request.auth.organisation` :
lecture limitée à son organisation sur toutes les collections, création au nom de soi-même uniquement, vote unique par
personne et par retex (index unique), modification et suppression réservées à l'auteur, e-mails des autres membres
masqués. Les membres peuvent modifier le nom et les objectifs de leur organisation, jamais son domaine ni sa
configuration IA.

Ces règles s'appliquent quel que soit le client : navigateur, MCP, `curl`. L'interface ne fait que refléter ce que
la base autorise.

## Hooks : une VM par handler

PocketBase exécute chaque handler JavaScript dans une machine virtuelle isolée. Une constante ou une fonction déclarée
au niveau d'un fichier `*.pb.js` n'est pas visible d'un handler à l'autre. La logique partagée vit donc dans des modules
CommonJS (`wecairn.js`, `ai.js`, `account.js`) chargés par `require(`${__hooks}/module.js`)` à l'intérieur de chaque
handler. Autre particularité : un champ JSON se lit par `record.getString("tags")` puis `JSON.parse`, pas par
`record.get()`.

| Fichier | Rôle |
|---|---|
| `main.pb.js` | rattachement par domaine, normalisation des tags |
| `account.pb.js`, `account.js` | détection superadmin, mot de passe unique application / console |
| `ai.pb.js`, `ai.js` | relais IA : dictée, extraction, session temps réel |
| `horizon.pb.js` | agrégat public et anonyme pour la page d'accueil |

## Interface sans build

`web/index.html` contient les styles, le balisage et la logique. Le SDK PocketBase est chargé depuis un CDN, les polices
depuis Google Fonts, avec repli système dans les deux cas. Le temps réel repose sur les abonnements PocketBase :
toute publication, vote ou commentaire dans l'organisation rafraîchit la page.

Le choix « un fichier, pas de build » est délibéré : n'importe qui peut lire, modifier et déployer l'interface sans
outillage. Si le projet grossit au point de le regretter, le découpage en modules ES natifs reste possible sans build.

## Le chemin vers l'horizon

La route `GET /api/wecairn/horizon` agrège, toutes organisations confondues, le nombre de retex par jour et les tags
les plus fréquents du jour. Aucun titre, aucun auteur, aucune organisation n'en sort ; les tags d'un jour ne sont
donnés que si au moins deux pierres ont été posées ce jour-là. La réponse est mise en cache cinq minutes côté
navigateur. C'est la seule donnée visible sans connexion.

## Sécurité

- Les clés IA ne quittent jamais le serveur : champ masqué (`hidden`) sur l'organisation ou variable d'environnement.
  En mode temps réel, le serveur génère un jeton éphémère limité à une session.
- Le mot de passe unique application / console n'existe que si un superutilisateur porte le même e-mail qu'un membre ;
  les hooks alignent les deux mots de passe à chaque connexion et à chaque changement.
- La réinitialisation de mot de passe demande un SMTP (réglage dans la console).
- Le micro exige HTTPS (ou `localhost`).
