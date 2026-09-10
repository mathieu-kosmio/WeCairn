/**
 * WeCairn : serveur MCP distant (Streamable HTTP, sans état) servi par PocketBase lui-même.
 *
 * Un agent reçoit l'adresse de l'instance, découvre le serveur (/llms.txt, /.well-known/mcp.json, GET /mcp),
 * demande à l'utilisateur une clé personnelle (générée dans « Mon compte », valable 30 jours) et l'envoie
 * en en-tête « Authorization: Bearer wc_… ». Chaque outil agit ensuite au nom de l'utilisateur, via l'API
 * REST de PocketBase en boucle locale, donc avec exactement ses droits (règles d'accès des collections).
 * Les outils et le prompt sont les mêmes que ceux du serveur local (mcp/server.js).
 * Module CommonJS chargé via require() depuis mcp.pb.js.
 */

const VERSION = "0.4.0";
const KEY_DAYS = 30;
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/* ---------- Clés d'API personnelles ---------- */
const hashKey = (key) => $security.sha256(String(key));

function createKey(app, user, name) {
  const key = "wc_" + $security.randomStringWithAlphabet(40, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
  const col = app.findCollectionByNameOrId("api_keys");
  const rec = new Record(col);
  rec.set("user", user.id);
  rec.set("name", String(name || "Mon agent").slice(0, 80));
  rec.set("prefix", key.slice(0, 10));
  rec.set("hash", hashKey(key));
  rec.set("expires", new Date(Date.now() + KEY_DAYS * 86400000).toISOString());
  app.save(rec);
  return { key, id: rec.id, prefix: rec.get("prefix"), expires: String(rec.get("expires")) };
}

/** Retourne l'utilisateur porteur d'une clé valide, ou null. */
function userForKey(app, key) {
  if (!/^wc_[A-Za-z0-9]{40}$/.test(String(key || ""))) return null;
  let rec;
  try { rec = app.findFirstRecordByData("api_keys", "hash", hashKey(key)); } catch (_) { return null; }
  const exp = Date.parse(String(rec.get("expires")).replace(" ", "T"));
  if (!exp || exp < Date.now()) return null;
  try { app.db().newQuery("UPDATE api_keys SET last_used = {:now} WHERE id = {:id}").bind({ now: new Date().toISOString().replace("T", " "), id: rec.id }).execute(); } catch (_) {}
  try { return app.findRecordById("users", rec.get("user")); } catch (_) { return null; }
}

/* ---------- Client REST en boucle locale, avec le jeton de l'utilisateur ---------- */
function client(app, user) {
  const base = String($os.getenv("WECAIRN_INTERNAL_URL") || "http://127.0.0.1:8090").replace(/\/+$/, "");
  const token = user.newAuthToken();
  const qs = (p) => Object.entries(p || {}).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const call = (method, path, body) => {
    const res = $http.send({ url: base + path, method, timeout: 20, headers: { Authorization: token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : "" });
    let data = null; try { data = res.raw ? JSON.parse(res.raw) : null; } catch (_) {}
    if (res.statusCode >= 400) {
      const first = data && data.data && Object.keys(data.data).length ? data.data[Object.keys(data.data)[0]] : null;
      throw new Error((data && data.message ? data.message : `HTTP ${res.statusCode}`) + (first && first.message ? ` (${Object.keys(data.data)[0]} : ${first.message})` : ""));
    }
    return data;
  };
  return {
    list: (col, p) => call("GET", `/api/collections/${col}/records?` + qs(Object.assign({ page: 1, perPage: 200 }, p))).items,
    one: (col, id, p) => call("GET", `/api/collections/${col}/records/${encodeURIComponent(id)}?` + qs(p)),
    create: (col, body) => call("POST", `/api/collections/${col}/records`, body),
    update: (col, id, body) => call("PATCH", `/api/collections/${col}/records/${encodeURIComponent(id)}`, body),
    remove: (col, id) => call("DELETE", `/api/collections/${col}/records/${encodeURIComponent(id)}`),
  };
}

/* ---------- Outils (mêmes noms, mêmes comportements que mcp/server.js) ---------- */
const hot = (r) => (r.vote_count + 1) / Math.pow((Date.now() - Date.parse(String(r.created).replace(" ", "T"))) / 3600000 + 2, 1.5);
const q = (s) => String(s).replace(/["\\]/g, "");
const tagsOf = (r) => Array.isArray(r.tags) ? r.tags : [];
const day = (d) => { const t = Date.parse(String(d).replace(" ", "T")); return isNaN(t) ? String(d) : new Date(t).toLocaleDateString("fr-FR"); };
const fmt = (r, voted) => [
  `### ${r.title}`,
  `id: ${r.id} · ${r.author_name} · ${day(r.created)} · ▲ ${r.vote_count}${voted ? " (calé par vous)" : ""} · ${r.comment_count} commentaire(s)`,
  tagsOf(r).length ? `tags: ${tagsOf(r).join(", ")}` : null,
  `Situation : ${r.situation}`,
  `Enseignement : ${r.learning}`,
  r.recommendation ? `Bonne pratique : ${r.recommendation}` : null,
  r.source_ref ? `Source : ${r.source_ref}` : null,
].filter(Boolean).join("\n");
const text = (s) => ({ content: [{ type: "text", text: s }] });
const myVotes = (c, me) => { const m = {}; c.list("votes", { filter: `user = "${me.id}"`, fields: "id,retex", perPage: 500 }).forEach((v) => { m[v.retex] = v.id; }); return m; };

const RETEX_PROPS = {
  title: { type: "string", minLength: 5, maxLength: 140, description: "L'enseignement en une phrase, formulé comme un conseil actionnable" },
  situation: { type: "string", minLength: 10, description: "Le contexte : projet, réunion, problème rencontré" },
  learning: { type: "string", minLength: 10, description: "Ce qu'on a appris, factuel, sans jugement de personne" },
  recommendation: { type: "string", description: "La bonne pratique à reproduire (ou l'erreur à éviter)" },
  tags: { type: "array", items: { type: "string" }, maxItems: 8, description: "Mots-clés courts en minuscules, ex. ['atelier', 'données']" },
  source: { type: "string", enum: ["mcp", "transcript"], description: "'transcript' si le retex est extrait d'un compte rendu ou d'une transcription de réunion" },
  source_ref: { type: "string", description: "Référence de la source, ex. 'Réunion de lancement DataWood, 3 sept. 2026'" },
};
const toRecord = (i, me) => ({
  title: i.title, situation: i.situation, learning: i.learning, recommendation: i.recommendation || "",
  tags: Array.isArray(i.tags) ? i.tags : [], source: i.source === "transcript" ? "transcript" : "mcp", source_ref: i.source_ref || "",
  organisation: me.organisation, author: me.id,
});
const need = (a, k) => { if (a[k] === undefined || a[k] === null || a[k] === "") throw new Error(`Paramètre manquant : ${k}`); return a[k]; };

const TOOLS = [
  { name: "list_retex", title: "Lister les retex", description: "Liste les retex de mon organisation, triés par tendance, date ou votes. Filtre optionnel par tag.",
    inputSchema: { type: "object", properties: { sort: { type: "string", enum: ["hot", "new", "top"], default: "hot" }, tag: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 15 } } },
    run: (c, me, a) => {
      const sort = a.sort || "hot", limit = Math.min(50, Math.max(1, a.limit || 15)), tag = a.tag ? String(a.tag).toLowerCase() : "";
      const voted = myVotes(c, me);
      let rows = c.list("retex_feed", { sort: sort === "top" ? "-vote_count,-created" : "-created", filter: tag ? `tags ~ "${q(tag)}"` : "" });
      if (tag) rows = rows.filter((r) => tagsOf(r).includes(tag));
      if (sort === "hot") rows.sort((x, y) => hot(y) - hot(x));
      rows = rows.slice(0, limit);
      return text(rows.length ? rows.map((r) => fmt(r, !!voted[r.id])).join("\n\n") : "Aucun retex.");
    } },
  { name: "search_retex", title: "Rechercher des retex", description: "Recherche dans les retex de mon organisation (titre, situation, enseignement, bonne pratique, tags). À utiliser avant de publier pour éviter les doublons, ou quand on cherche si l'équipe a déjà rencontré un problème.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string", minLength: 2 }, limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } } },
    run: (c, me, a) => {
      const query = String(need(a, "query")), limit = Math.min(50, Math.max(1, a.limit || 10));
      const voted = myVotes(c, me);
      const words = query.split(/\s+/).map(q).filter((w) => w.length >= 2);
      const filter = words.map((w) => `(title ~ "${w}" || situation ~ "${w}" || learning ~ "${w}" || recommendation ~ "${w}" || tags ~ "${w}")`).join(" && ");
      const rows = c.list("retex_feed", { filter, sort: "-vote_count,-created", perPage: limit });
      return text(rows.length ? rows.map((r) => fmt(r, !!voted[r.id])).join("\n\n") : `Aucun retex ne correspond à « ${query} ».`);
    } },
  { name: "get_retex", title: "Lire un retex", description: "Affiche un retex complet avec ses commentaires.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    run: (c, me, a) => {
      const id = String(need(a, "id"));
      const voted = myVotes(c, me);
      const r = c.one("retex_feed", id);
      const cs = c.list("comments", { filter: `retex = "${q(id)}"`, sort: "created", expand: "author", perPage: 500 });
      const comments = cs.map((x) => `- ${x.expand && x.expand.author ? x.expand.author.name : "?"} (${day(x.created)}) : ${x.body}`).join("\n");
      return text(fmt(r, !!voted[r.id]) + (comments ? `\n\nCommentaires :\n${comments}` : "\n\nAucun commentaire."));
    } },
  { name: "create_retex", title: "Poser une pierre (publier un retex)", description: "Publie un retex dans mon organisation au nom de l'utilisateur connecté (+10 points). Vérifier d'abord avec search_retex qu'un retex similaire n'existe pas déjà ; si c'est le cas, préférer un commentaire ou un calage (vote).",
    inputSchema: { type: "object", required: ["title", "situation", "learning"], properties: RETEX_PROPS },
    run: (c, me, a) => { const r = c.create("retex", toRecord(a, me)); return text(`Pierre posée (id ${r.id}) : « ${r.title} ». +10 points pour ${me.name}.`); } },
  { name: "create_retex_batch", title: "Poser plusieurs pierres", description: "Publie plusieurs retex d'un coup, typiquement après extraction depuis une transcription de réunion. Présenter la liste à l'utilisateur pour validation avant d'appeler cet outil.",
    inputSchema: { type: "object", required: ["items"], properties: { items: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", required: ["title", "situation", "learning"], properties: RETEX_PROPS } } } },
    run: (c, me, a) => { const done = (need(a, "items") || []).map((i) => c.create("retex", toRecord(i, me))); return text(`${done.length} retex publié(s) :\n` + done.map((d) => `- ${d.title} (${d.id})`).join("\n")); } },
  { name: "update_retex", title: "Modifier une de mes pierres", description: "Modifie un retex dont l'utilisateur connecté est l'auteur (titre, situation, enseignement, bonne pratique, tags). Les champs omis sont conservés.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, title: RETEX_PROPS.title, situation: RETEX_PROPS.situation, learning: RETEX_PROPS.learning, recommendation: RETEX_PROPS.recommendation, tags: RETEX_PROPS.tags } },
    run: (c, me, a) => {
      const id = String(need(a, "id")); const data = {};
      for (const k of ["title", "situation", "learning", "recommendation", "tags"]) if (a[k] !== undefined) data[k] = a[k];
      if (data.tags) data.tags = data.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
      const r = c.update("retex", id, data); return text(`Retex modifié (id ${r.id}) : « ${r.title} ».`);
    } },
  { name: "delete_retex", title: "Retirer une de mes pierres", description: "Supprime définitivement un retex dont l'utilisateur connecté est l'auteur, avec ses votes et commentaires. Demander confirmation à l'utilisateur avant d'appeler cet outil.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    run: (c, me, a) => { const id = String(need(a, "id")); c.remove("retex", id); return text(`Retex ${id} retiré du cairn.`); } },
  { name: "vote_retex", title: "Caler une pierre (vote « utile »)", description: "Marque un retex comme utile (ou retire le calage).",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" }, remove: { type: "boolean", default: false } } },
    run: (c, me, a) => {
      const id = String(need(a, "id")); const voted = myVotes(c, me);
      if (a.remove) { if (voted[id]) c.remove("votes", voted[id]); return text("Calage retiré."); }
      if (!voted[id]) c.create("votes", { retex: id, user: me.id }); return text("Pierre calée (+1 point pour vous, +2 pour l'auteur).");
    } },
  { name: "comment_retex", title: "Commenter un retex", description: "Ajoute un commentaire (nuance, contre-exemple, complément) à un retex (+3 points).",
    inputSchema: { type: "object", required: ["id", "body"], properties: { id: { type: "string" }, body: { type: "string", minLength: 1, maxLength: 4000 } } },
    run: (c, me, a) => { c.create("comments", { retex: String(need(a, "id")), author: me.id, body: String(need(a, "body")) }); return text("Commentaire ajouté (+3 points)."); } },
  { name: "leaderboard", title: "La cordée (classement)", description: "Classement des contributeurs de mon organisation (points, retex, calages).",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } } },
    run: (c, me, a) => {
      const rows = c.list("leaderboard", { sort: "-points", perPage: Math.min(50, Math.max(1, a.limit || 10)) });
      return text(rows.map((r, i) => `${i + 1}. ${r.name} · ${r.points} pts (${r.retex_count} retex, ${r.votes_received} calages reçus, ${r.comments_count} commentaires)`).join("\n") || "Aucun contributeur.");
    } },
];

const PROMPTS = [
  { name: "extraire_retex", title: "Extraire des retex d'une réunion", description: "Lit une transcription ou un compte rendu de réunion et en extrait les retex à publier, après validation.",
    arguments: [{ name: "transcript", description: "Transcription ou compte rendu", required: true }, { name: "meeting_ref", description: "Nom et date de la réunion", required: false }],
    get: (a) => ({ description: "Extraire des retex d'une réunion", messages: [{ role: "user", content: { type: "text", text:
`Voici une transcription de réunion${a.meeting_ref ? ` (${a.meeting_ref})` : ""}.

Extrais-en les retex : les enseignements réutilisables par l'équipe (ce qui a marché, ce qui a échoué et pourquoi, les bonnes pratiques à reproduire). Ignore les décisions opérationnelles, les actions à faire et les points d'information sans enseignement.

Pour chaque retex, propose : un titre (une phrase actionnable), la situation, l'enseignement, une bonne pratique si elle se dégage, 2 à 4 tags. Reste factuel, ne nomme pas les personnes de manière critique. Vise entre 1 et 6 retex, pas plus.

1. Utilise search_retex sur les thèmes principaux pour éviter les doublons.
2. Présente-moi la liste des retex proposés pour validation.
3. Après mon accord, publie-les avec create_retex_batch en indiquant source = "transcript" et source_ref = "${a.meeting_ref || "réunion"}".

Transcription :
"""
${a.transcript || ""}
"""` } }] }) },
];

/* ---------- Textes de découverte et instructions ---------- */
function instructions(me, orgName, appName) {
  return `Vous êtes connecté à ${appName}, le cairn de ${orgName}, au nom de ${me.name}. ${appName} sert à partager des retours d'expérience (retex) en équipe : chaque retex est une « pierre » posée sur le cairn (titre = l'enseignement en une phrase, situation, ce qu'on a appris, bonne pratique). L'équipe « cale » les pierres utiles (vote) et commente.

À la première connexion, présentez brièvement à l'utilisateur ce que vous pouvez faire pour lui :
- retrouver ce que l'équipe a déjà appris sur un sujet (search_retex, list_retex, get_retex) ;
- poser une pierre au fil d'une conversation (create_retex), ou plusieurs d'un coup (create_retex_batch) ;
- extraire les retex d'un compte rendu ou d'une transcription de réunion (prompt extraire_retex), avec validation avant publication ;
- caler ou commenter une pierre (vote_retex, comment_retex), corriger ou retirer les siennes (update_retex, delete_retex) ;
- consulter la cordée, le classement de l'équipe (leaderboard).

Bonnes pratiques : chercher avant de publier pour éviter les doublons ; si un retex proche existe, préférer un calage ou un commentaire ; présenter la liste avant une publication en lot ; demander confirmation avant une suppression. Vous n'avez que les droits de l'utilisateur : son organisation seulement, et ses propres pierres en écriture.`;
}

function baseURL(app, e) {
  const u = String(app.settings().meta.appURL || "").replace(/\/+$/, "");
  if (u && !/localhost|127\.0\.0\.1/.test(u)) return u;
  const proto = e.request.header.get("X-Forwarded-Proto") || "http";
  return `${proto}://${e.request.host}`;
}

function llmsTxt(base, appName) {
  return `# ${appName}

> ${appName} est une application de partage de retours d'expérience (retex) en équipe. Chaque retex est une « pierre »
> posée sur le cairn de l'organisation ; l'équipe cale (vote) et commente. Interface en français.

## Serveur MCP (pour les agents IA)

- Adresse : ${base}/mcp
- Transport : MCP Streamable HTTP, sans état (POST JSON-RPC ; GET renvoie 405).
- Authentification : en-tête \`Authorization: Bearer <clé>\`. La clé commence par \`wc_\` et vaut ${KEY_DAYS} jours.
- Description lisible par machine : ${base}/.well-known/mcp.json

### Obtenir une clé (à expliquer à l'utilisateur)

1. Ouvrir ${base} et se connecter (ou créer un compte avec son e-mail professionnel).
2. Menu utilisateur (en haut à droite) > « Connecter un agent (MCP) » > « Générer une clé ».
3. Copier la clé affichée (elle ne l'est qu'une fois) et la coller dans la conversation avec l'agent.

### Configurer l'agent

- Claude Code : \`claude mcp add --transport http wecairn ${base}/mcp --header "Authorization: Bearer <clé>"\`
- Autres clients MCP : URL ${base}/mcp, en-tête HTTP Authorization: Bearer <clé>.
- Sans clé, POST ${base}/mcp répond 401 avec ces mêmes instructions.

### Outils

list_retex, search_retex, get_retex, create_retex, create_retex_batch, update_retex, delete_retex, vote_retex,
comment_retex, leaderboard. Prompt : extraire_retex (retex depuis une transcription de réunion).
Le serveur renvoie des instructions détaillées à l'initialisation ; l'agent agit avec les droits de l'utilisateur.

## Documentation

- ${base}/ : l'application
- https://github.com/mathieu-kosmio/WeCairn : code source (MIT)
`;
}

function helpJSON(base, appName) {
  return {
    name: "wecairn", title: `${appName} MCP`, version: VERSION,
    description: `Serveur MCP de ${appName} : lire et alimenter les retours d'expérience de son organisation depuis un agent IA.`,
    url: `${base}/mcp`, transport: "streamable-http", stateless: true,
    authentication: { type: "bearer", header: "Authorization: Bearer <clé>", key_prefix: "wc_", validity_days: KEY_DAYS,
      how_to_get_key: `Se connecter sur ${base}, menu utilisateur > « Connecter un agent (MCP) » > « Générer une clé », puis coller la clé dans la conversation avec l'agent.` },
    setup: { claude_code: `claude mcp add --transport http wecairn ${base}/mcp --header "Authorization: Bearer <clé>"` },
    tools: TOOLS.map((t) => t.name), prompts: PROMPTS.map((p) => p.name),
    documentation: `${base}/llms.txt`,
  };
}

/* ---------- JSON-RPC ---------- */
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });

function handleMessage(app, msg, ctx) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg && msg.id, -32600, "Requête JSON-RPC invalide.");
  const { id, method } = msg, params = msg.params || {};
  const isNotification = id === undefined;
  try {
    switch (method) {
      case "initialize": {
        const asked = String(params.protocolVersion || "");
        return rpcResult(id, { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: "wecairn", title: `${ctx.appName} MCP`, version: VERSION }, instructions: instructions(ctx.me, ctx.orgName, ctx.appName) });
      }
      case "ping": return rpcResult(id, {});
      case "tools/list": return rpcResult(id, { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema })) });
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) return rpcError(id, -32602, `Outil inconnu : ${params.name}`);
        try { return rpcResult(id, tool.run(ctx.client(), ctx.me, params.arguments || {})); }
        catch (err) { return rpcResult(id, { content: [{ type: "text", text: `Erreur : ${err && err.message ? err.message : err}` }], isError: true }); }
      }
      case "prompts/list": return rpcResult(id, { prompts: PROMPTS.map((p) => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments })) });
      case "prompts/get": {
        const p = PROMPTS.find((x) => x.name === params.name);
        if (!p) return rpcError(id, -32602, `Prompt inconnu : ${params.name}`);
        return rpcResult(id, p.get(params.arguments || {}));
      }
      case "resources/list": return rpcResult(id, { resources: [] });
      case "resources/templates/list": return rpcResult(id, { resourceTemplates: [] });
      default:
        if (isNotification || method.startsWith("notifications/")) return null;
        return rpcError(id, -32601, `Méthode inconnue : ${method}`);
    }
  } catch (err) {
    return rpcError(id, -32603, `Erreur interne : ${err && err.message ? err.message : err}`);
  }
}

/** Traite un corps POST /mcp (message ou lot). Retourne { status, body } ; body null = 202 sans contenu. */
function handleBody(app, raw, ctx) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { return { status: 400, body: rpcError(null, -32700, "JSON invalide.") }; }
  if (Array.isArray(parsed)) {
    const out = parsed.map((m) => handleMessage(app, m, ctx)).filter(Boolean);
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }
  const res = handleMessage(app, parsed, ctx);
  return res ? { status: 200, body: res } : { status: 202, body: null };
}

module.exports = { VERSION, KEY_DAYS, createKey, userForKey, client, handleBody, llmsTxt, helpJSON, baseURL, TOOLS, PROMPTS };
