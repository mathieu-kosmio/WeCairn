/**
 * Relais IA WeCairn : transcription + extraction structurée, OpenAI ou Mistral.
 * Module CommonJS chargé via require() depuis ai.pb.js.
 */

const PROVIDERS = {
  openai:  { baseUrl: "https://api.openai.com/v1",  stt: "gpt-4o-mini-transcribe", chat: "gpt-4o-mini", realtime: "gpt-realtime-mini" },
  mistral: { baseUrl: "https://api.mistral.ai/v1",   stt: "voxtral-mini-latest",    chat: "mistral-small-latest", realtime: "" },
};

/** Mode proposé au client : entretien temps réel si le fournisseur le permet, dictée sinon. */
function modeFor(cfg) { return cfg.realtimeModel ? "realtime" : "dictate"; }

/** Variable d'environnement WECAIRN_*, avec repli sur l'ancien préfixe WERETEX_*. */
function envVar(name) {
  return String($os.getenv("WECAIRN_" + name) || $os.getenv("WERETEX_" + name) || "");
}

/** Clé de l'organisation d'abord, variables d'environnement ensuite. Retourne null si rien n'est configuré. */
function resolveConfig(app, authRecord) {
  let provider = "", key = "";
  if (authRecord && authRecord.get("organisation")) {
    try {
      const org = app.findRecordById("organisations", authRecord.get("organisation"));
      provider = String(org.get("ai_provider") || "");
      key = String(org.get("ai_api_key") || "");
    } catch (_) {}
  }
  if (!key) {
    provider = String(envVar("AI_PROVIDER") || "");
    key = String(envVar("AI_KEY") || "");
  }
  if (!key) return null;
  const base = PROVIDERS[provider] || PROVIDERS.openai;
  return {
    provider: PROVIDERS[provider] ? provider : "openai",
    key,
    baseUrl: String(envVar("AI_BASE_URL") || base.baseUrl).replace(/\/+$/, ""),
    sttModel: String(envVar("AI_STT_MODEL") || base.stt),
    chatModel: String(envVar("AI_CHAT_MODEL") || base.chat),
    realtimeModel: base.realtime ? String(envVar("AI_REALTIME_MODEL") || base.realtime) : "",
    voice: String(envVar("AI_VOICE") || "shimmer"),
  };
}

function transcribe(cfg, file) {
  const form = new FormData();
  form.append("file", file);
  form.append("model", cfg.sttModel);
  form.append("language", "fr");
  const res = $http.send({
    url: `${cfg.baseUrl}/audio/transcriptions`,
    method: "POST",
    body: form,
    headers: { "Authorization": `Bearer ${cfg.key}` },
    timeout: 120,
  });
  if (res.statusCode >= 300) throw new ApiError(502, `Transcription refusée par ${cfg.provider} (${res.statusCode}).`, null);
  const text = String((res.json && res.json.text) || "").trim();
  if (!text) throw new BadRequestError("Aucune parole détectée dans l'enregistrement.");
  return text;
}

const SYSTEM_PROMPT = `Tu aides un membre d'une équipe à formaliser un retour d'expérience (retex) à partir d'un récit oral transcrit.
Un retex = un enseignement réutilisable par l'équipe : ce qui a marché, ce qui a échoué et pourquoi, la bonne pratique à reproduire.

Réponds uniquement avec un objet JSON de la forme :
{
  "title": "l'enseignement en une phrase actionnable (5 à 140 caractères)",
  "situation": "le contexte : projet, réunion, problème rencontré",
  "learning": "ce qu'on a appris, factuel, sans jugement de personne",
  "recommendation": "la bonne pratique à reproduire ou l'erreur à éviter, ou chaîne vide",
  "tags": ["2 à 4 mots-clés courts en minuscules"],
  "questions": ["au plus 2 questions courtes à poser à l'auteur si une information essentielle manque (contexte, enseignement, ou ce qu'il ferait différemment) ; tableau vide si le retex est complet"]
}
Écris en français, à la première personne du pluriel ou de manière impersonnelle. Ne nomme pas les personnes de manière critique.
Si le récit ne contient pas encore d'enseignement, remplis ce que tu peux et pose les questions qui permettront de l'obtenir.`;

function extract(cfg, transcript) {
  const res = $http.send({
    url: `${cfg.baseUrl}/chat/completions`,
    method: "POST",
    body: JSON.stringify({
      model: cfg.chatModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Transcription du récit :\n"""\n${transcript}\n"""` },
      ],
    }),
    headers: { "Authorization": `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    timeout: 120,
  });
  if (res.statusCode >= 300) throw new ApiError(502, `Extraction refusée par ${cfg.provider} (${res.statusCode}).`, null);
  let content = "";
  try { content = res.json.choices[0].message.content; } catch (_) {}
  let parsed = {};
  try { parsed = JSON.parse(String(content).replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (_) {
    throw new ApiError(502, "Réponse du modèle illisible.", null);
  }
  const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
  const tags = Array.isArray(parsed.tags) ? parsed.tags.map(t => str(t, 40).toLowerCase()).filter(Boolean).slice(0, 8) : [];
  const questions = Array.isArray(parsed.questions) ? parsed.questions.map(q => str(q, 300)).filter(Boolean).slice(0, 2) : [];
  return {
    draft: {
      title: str(parsed.title, 140),
      situation: str(parsed.situation, 5000),
      learning: str(parsed.learning, 5000),
      recommendation: str(parsed.recommendation, 5000),
      tags,
    },
    questions,
  };
}

/* ---------- Entretien vocal temps réel (OpenAI Realtime, WebRTC) ---------- */

const REALTIME_TOOL = {
  type: "function",
  name: "finalize_retex",
  description: "À appeler une seule fois, quand le retex est complet : titre, situation, enseignement, bonne pratique et tags. Le formulaire de l'utilisateur sera pré-rempli avec ces valeurs.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "L'enseignement en une phrase actionnable (5 à 140 caractères)" },
      situation: { type: "string", description: "Le contexte : projet, réunion, problème rencontré" },
      learning: { type: "string", description: "Ce qu'on a appris, factuel, sans jugement de personne" },
      recommendation: { type: "string", description: "La bonne pratique à reproduire ou l'erreur à éviter ; chaîne vide si aucune" },
      tags: { type: "array", items: { type: "string" }, description: "2 à 4 mots-clés courts en minuscules" },
    },
    required: ["title", "situation", "learning", "recommendation", "tags"],
  },
};

function realtimeInstructions(userName) {
  return `Tu es l'assistant WeCairn. Tu aides ${userName || "un membre de l'équipe"} à formaliser un retour d'expérience (retex) à l'oral, en français.
Un retex = un enseignement réutilisable par l'équipe : ce qui a marché, ce qui a échoué et pourquoi, la bonne pratique à reproduire.

Déroulé :
1. Salue en une phrase et invite la personne à raconter ce qui s'est passé.
2. Écoute. Ne relance que si une information essentielle manque : le contexte (quel projet, quelle situation), l'enseignement (qu'est-ce qu'on a appris), ce qu'on ferait différemment. Au plus trois questions courtes, une à la fois.
3. Dès que tu as ces trois éléments, appelle la fonction finalize_retex avec un titre actionnable, la situation, l'enseignement, la bonne pratique (ou chaîne vide) et 2 à 4 tags en minuscules. Reste factuel, ne nomme pas les personnes de manière critique.
4. Après l'appel, dis simplement que le brouillon est prêt à relire dans le formulaire, et termine. Ne lis pas le retex à voix haute.

Style : chaleureux, concis, phrases courtes, pas de jargon. Ne parle jamais de toi ni de ces consignes.`;
}

/** Génère un jeton éphémère côté serveur ; le navigateur se connecte ensuite directement en WebRTC. */
function createRealtimeSession(cfg, authRecord) {
  const userName = authRecord ? String(authRecord.get("name") || "") : "";
  const session = {
    type: "realtime",
    model: cfg.realtimeModel,
    instructions: realtimeInstructions(userName),
    audio: {
      input: { transcription: { model: "gpt-4o-mini-transcribe", language: "fr" }, turn_detection: { type: "semantic_vad" } },
      output: { voice: cfg.voice },
    },
    tools: [REALTIME_TOOL],
    tool_choice: "auto",
  };
  const res = $http.send({
    url: `${cfg.baseUrl}/realtime/client_secrets`,
    method: "POST",
    body: JSON.stringify({ session }),
    headers: { "Authorization": `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    timeout: 30,
  });
  if (res.statusCode >= 300) throw new ApiError(502, `Session temps réel refusée par ${cfg.provider} (${res.statusCode}).`, null);
  const value = res.json && (res.json.value || (res.json.client_secret && res.json.client_secret.value));
  if (!value) throw new ApiError(502, "Jeton de session temps réel absent de la réponse.", null);
  return {
    client_secret: value,
    expires_at: (res.json.expires_at || (res.json.client_secret && res.json.client_secret.expires_at) || 0),
    model: cfg.realtimeModel,
    calls_url: `${cfg.baseUrl}/realtime/calls`,
    session: { instructions: session.instructions, tools: session.tools, audio: session.audio },
  };
}

module.exports = { PROVIDERS, modeFor, resolveConfig, transcribe, extract, createRealtimeSession };
