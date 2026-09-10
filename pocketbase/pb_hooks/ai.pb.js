/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : partage vocal d'un retex, relayé vers Mistral ou OpenAI.
 *
 * Le fournisseur résolu détermine le mode proposé à l'utilisateur :
 *   mistral -> « dictate »  : enregistrement, transcription (Voxtral), extraction JSON, questions écrites de relance
 *   openai  -> « realtime » : entretien vocal en temps réel (API Realtime, WebRTC), l'IA relance de vive voix
 *              et finalise le retex par appel de fonction ; la dictée reste disponible en repli.
 *
 * Routes (authentification requise) :
 *   GET  /api/wecairn/ai/config            -> { enabled, provider, mode }  (jamais la clé)
 *   POST /api/wecairn/ai/dictate           -> multipart audio + transcript  -> { transcript, draft, questions }
 *   POST /api/wecairn/ai/extract           -> { transcript }                -> { draft, questions }
 *   POST /api/wecairn/ai/realtime/session  -> { client_secret, model, calls_url, expires_at }  (openai uniquement)
 *
 * Résolution de la clé : organisation (ai_provider / ai_api_key, console superadmin) puis variables
 * d'environnement globales (secrets Coolify) : WECAIRN_AI_PROVIDER, WECAIRN_AI_KEY, et en option
 * WECAIRN_AI_BASE_URL, WECAIRN_AI_STT_MODEL, WECAIRN_AI_CHAT_MODEL, WECAIRN_AI_REALTIME_MODEL, WECAIRN_AI_VOICE.
 */

routerAdd("GET", "/api/wecairn/ai/config", (e) => {
  const ai = require(`${__hooks}/ai.js`);
  const cfg = ai.resolveConfig($app, e.auth);
  return e.json(200, { enabled: !!cfg, provider: cfg ? cfg.provider : null, mode: cfg ? ai.modeFor(cfg) : null });
}, $apis.requireAuth());

routerAdd("POST", "/api/wecairn/ai/dictate", (e) => {
  const ai = require(`${__hooks}/ai.js`);
  const cfg = ai.resolveConfig($app, e.auth);
  if (!cfg) throw new BadRequestError("Le partage vocal n'est pas activé pour votre organisation.");

  let files = [];
  try { files = e.findUploadedFiles("audio") || []; } catch (_) { files = []; }
  if (!files.length) throw new BadRequestError("Aucun enregistrement audio reçu.");
  if (files[0].size > 25 * 1024 * 1024) throw new BadRequestError("Enregistrement trop volumineux (25 Mo maximum).");

  const previous = String(e.requestInfo().body.transcript || "").slice(0, 20000);
  const segment = ai.transcribe(cfg, files[0]);
  const transcript = (previous ? previous + "\n\n" : "") + segment;
  const result = ai.extract(cfg, transcript);
  return e.json(200, { transcript, segment, draft: result.draft, questions: result.questions });
}, $apis.requireAuth());

routerAdd("POST", "/api/wecairn/ai/extract", (e) => {
  const ai = require(`${__hooks}/ai.js`);
  const cfg = ai.resolveConfig($app, e.auth);
  if (!cfg) throw new BadRequestError("Le partage vocal n'est pas activé pour votre organisation.");
  const transcript = String(e.requestInfo().body.transcript || "").trim().slice(0, 20000);
  if (transcript.length < 10) throw new BadRequestError("Récit trop court pour en extraire un retex.");
  const result = ai.extract(cfg, transcript);
  return e.json(200, { draft: result.draft, questions: result.questions });
}, $apis.requireAuth());

routerAdd("POST", "/api/wecairn/ai/realtime/session", (e) => {
  const ai = require(`${__hooks}/ai.js`);
  const cfg = ai.resolveConfig($app, e.auth);
  if (!cfg) throw new BadRequestError("Le partage vocal n'est pas activé pour votre organisation.");
  if (ai.modeFor(cfg) !== "realtime") throw new BadRequestError("L'entretien vocal en temps réel nécessite une clé OpenAI.");
  return e.json(200, ai.createRealtimeSession(cfg, e.auth));
}, $apis.requireAuth());
