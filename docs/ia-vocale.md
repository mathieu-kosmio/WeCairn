# Partage vocal (IA)

Dans « Poser une pierre », l'utilisateur peut raconter son retex à l'oral. Le mode dépend du fournisseur configuré.
Dans les deux cas, le formulaire est pré-rempli et rien n'est publié sans relecture.

| Clé configurée | Mode | Fonctionnement |
|---|---|---|
| **Mistral** | Dictée | Enregistrement au micro, transcription (Voxtral), extraction structurée (Mistral Small). Si une information manque, l'IA pose une ou deux questions par écrit ; l'utilisateur répond en réenregistrant, le récit s'accumule. |
| **OpenAI** | Entretien temps réel | Conversation vocale (API Realtime, WebRTC) : l'IA écoute, relance de vive voix si le contexte, l'enseignement ou la bonne pratique manquent (trois questions au plus), puis finalise le retex par appel de fonction. Le transcript s'affiche en direct. La dictée reste disponible en repli ; un entretien interrompu avant la fin est structuré à partir de ce qui a été dit. |

Modèles par défaut (surchargeables par variables d'environnement) : Mistral `voxtral-mini-latest` et
`mistral-small-latest` ; OpenAI `gpt-4o-mini-transcribe` et `gpt-4o-mini` pour la dictée, `gpt-realtime-mini`
(voix `marin`) pour l'entretien.

## Où va la clé

La clé ne quitte jamais le serveur. En dictée, le navigateur envoie l'audio à PocketBase (`/api/wecairn/ai/dictate`),
qui appelle le fournisseur. En temps réel, PocketBase génère un jeton éphémère (`/api/wecairn/ai/realtime/session`,
valable quelques minutes, limité à cette session) et le navigateur se connecte directement à OpenAI en WebRTC avec ce
jeton. Toutes les routes exigent un utilisateur connecté.

Résolution de la clé, dans l'ordre :

1. **Par organisation** : champs `ai_provider` et `ai_api_key` de la collection `organisations`, renseignés depuis la
   console superadmin (`/_/`). Le champ clé est masqué : il n'apparaît jamais dans l'API, même pour les membres, et un
   membre ne peut pas le modifier. Chaque organisation choisit ainsi son fournisseur, son mode et paie sa consommation.
2. **Globale** : variables d'environnement `WECAIRN_AI_PROVIDER` et `WECAIRN_AI_KEY` (secrets Coolify).

Sans clé, les boutons vocaux n'apparaissent pas. Variables optionnelles : `WECAIRN_AI_BASE_URL` (endpoint compatible),
`WECAIRN_AI_STT_MODEL`, `WECAIRN_AI_CHAT_MODEL`, `WECAIRN_AI_REALTIME_MODEL`, `WECAIRN_AI_VOICE`.

## Données, coûts, prérequis

Les enregistrements transitent chez le fournisseur choisi (Mistral en Union européenne, OpenAI aux États-Unis) : à
mentionner dans les conditions d'usage. Ordre de grandeur des coûts : quelques centimes par dictée, quelques dizaines
de centimes par entretien temps réel. Le micro nécessite HTTPS (ou `localhost`).

## Routes

| Route | Rôle |
|---|---|
| `GET /api/wecairn/ai/config` | `{ enabled, provider, mode }` pour l'utilisateur connecté |
| `POST /api/wecairn/ai/dictate` | multipart `audio` (+ `transcript` cumulé) : transcription puis extraction |
| `POST /api/wecairn/ai/extract` | `{ transcript }` : extraction seule (repli de l'entretien interrompu) |
| `POST /api/wecairn/ai/realtime/session` | jeton éphémère et consignes pour l'entretien (OpenAI seulement) |

La logique est dans `pb_hooks/ai.js` (fournisseurs, consignes en français, schéma de l'outil `finalize_retex`) et les
routes dans `pb_hooks/ai.pb.js`.
