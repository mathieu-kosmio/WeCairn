/**
 * WeCairn : OAuth 2.1 devant le serveur MCP, pour les clients qui ne savent pas envoyer une clé (connecteurs
 * claude.ai, Cowork, ChatGPT…). Code d'autorisation + PKCE (S256), enregistrement dynamique des clients (RFC 7591),
 * métadonnées RFC 8414 et RFC 9728. À la fin du flux, le jeton d'accès est une clé personnelle ordinaire
 * (api_keys, 30 jours, révocable dans « Mon compte ») : le serveur MCP ne fait aucune différence.
 * Module CommonJS chargé via require() depuis oauth.pb.js.
 */

const CODE_TTL_S = 600;
const SCOPE = "retex";

const noStore = (e) => { e.response.header().set("Cache-Control", "no-store"); e.response.header().set("Pragma", "no-cache"); };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** base64url d'une empreinte SHA-256 donnée en hexadécimal ($security.sha256). */
function hexToB64url(hex) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = []; for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? A[n & 63] : "=");
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const pkceOk = (verifier, challenge) => !!verifier && hexToB64url($security.sha256(String(verifier))) === String(challenge);

const isRedirectOk = (u) => /^https:\/\/[^\s/?#]+/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);

/* ---------- Métadonnées de découverte ---------- */
function serverMetadata(base) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
    service_documentation: `${base}/llms.txt`,
  };
}
function resourceMetadata(base) {
  return { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ["header"], scopes_supported: [SCOPE], resource_name: "WeCairn MCP", resource_documentation: `${base}/llms.txt` };
}

/* ---------- Clients (enregistrement dynamique) ---------- */
function registerClient(app, body) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String).filter(isRedirectOk) : [];
  if (!uris.length) throw new BadRequestError("redirect_uris : au moins une adresse https (ou http://localhost) est requise.");
  const rec = new Record(app.findCollectionByNameOrId("oauth_clients"));
  rec.set("client_id", $security.randomStringWithAlphabet(32, "abcdefghijklmnopqrstuvwxyz0123456789"));
  rec.set("name", String(body.client_name || "Agent").slice(0, 80));
  rec.set("redirect_uris", JSON.stringify(uris));
  app.save(rec);
  return { client_id: rec.get("client_id"), client_id_issued_at: Math.floor(Date.now() / 1000), client_name: rec.get("name"), redirect_uris: uris,
    token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"], scope: SCOPE };
}
function findClient(app, clientId) {
  try { return app.findFirstRecordByData("oauth_clients", "client_id", String(clientId || "")); } catch (_) { return null; }
}
/** Vérifie client et redirect_uri ; retourne { client, redirectUri } ou lève. */
function checkClient(app, clientId, redirectUri) {
  const client = findClient(app, clientId);
  if (!client) throw new BadRequestError("client_id inconnu : le client doit d'abord s'enregistrer sur /oauth/register.");
  let list = [];
  try { const v = client.get("redirect_uris"); list = (Array.isArray(v) ? v : JSON.parse(String(v || "[]"))).map(String); } catch (_) { list = []; }
  const ru = String(redirectUri || "") || (list.length === 1 ? list[0] : "");
  if (!list.includes(ru)) throw new BadRequestError("redirect_uri absent de la liste enregistrée pour ce client.");
  return { client, redirectUri: ru };
}

/* ---------- Codes d'autorisation (mémoire, 10 minutes) ---------- */
const codeKey = (code) => "oauth:code:" + $security.sha256(String(code));
function issueCode(app, data) {
  const code = $security.randomStringWithAlphabet(40, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
  app.store().set(codeKey(code), JSON.stringify(Object.assign({ exp: Date.now() + CODE_TTL_S * 1000 }, data)));
  return code;
}
function consumeCode(app, code) {
  const k = codeKey(code);
  const raw = app.store().get(k);
  if (!raw) return null;
  app.store().remove(k);
  const d = JSON.parse(String(raw));
  return d.exp > Date.now() ? d : null;
}
const withQuery = (uri, params) => uri + (uri.includes("?") ? "&" : "?") + Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

/* ---------- Page d'autorisation ---------- */
function authorizePage(ctx) {
  // ctx = { appName, client: { name }, params: { client_id, redirect_uri, state, code_challenge, scope }, error? }
  const p = ctx.params || {};
  const data = esc(JSON.stringify(p));
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autoriser un agent · ${esc(ctx.appName)}</title>
<style>
  :root { --bg:#ebe4d6; --card:#f8f4ec; --card-2:#f1ebdf; --ink:#2b2f36; --muted:#5c606a; --line:#d9d1c1; --accent:#e0743a; --accent-ink:#9e4514; --focus:#2f5c75; }
  @media (prefers-color-scheme: dark) { :root { --bg:#2b2f36; --card:#353a43; --card-2:#3d434d; --ink:#ece6da; --muted:#b3ada1; --line:#4a505b; --accent-ink:#f0a070; } }
  * { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px }
  .card { width:100%; max-width:440px; background:var(--card); border-radius:6px 6px 22px 6px; padding:28px 30px 24px }
  .logo { font-family:Georgia,"Iowan Old Style",serif; font-size:20px; margin:0 0 18px } .logo b { color:var(--accent-ink); font-weight:400 }
  .kicker { font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--accent-ink); margin:0 0 6px }
  h1 { font-family:Georgia,serif; font-weight:400; font-size:24px; line-height:1.2; margin:0 0 12px }
  p { margin:0 0 12px } .muted { color:var(--muted); font-size:13px }
  label { display:block; font-size:13px; color:var(--muted); margin:10px 0 4px } input { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:6px; background:var(--card-2); color:var(--ink); font:inherit }
  input:focus { outline:2px solid var(--focus); outline-offset:1px }
  .row { display:flex; gap:10px; justify-content:flex-end; margin-top:18px } button { font:inherit; font-weight:600; padding:10px 16px; border-radius:6px 6px 14px 6px; border:1px solid var(--line); background:var(--card-2); color:var(--ink); cursor:pointer }
  button.primary { background:var(--accent); border-color:var(--accent); color:#2b1a10 } .msg { color:#9e2f2f; font-size:13px; min-height:1.2em; margin:8px 0 0 } [hidden] { display:none !important }
  ul { margin:0 0 14px; padding-left:18px } li { margin:2px 0 }
</style></head>
<body><main class="card" id="app" data-params="${data}">
  <p class="logo">We<b>Cairn</b></p>
  ${ctx.error ? `<p class="kicker">Demande refusée</p><h1>Impossible d'autoriser cet agent</h1><p>${esc(ctx.error)}</p><p class="muted">Fermez cette fenêtre et relancez la connexion depuis l'agent.</p>` : `
  <p class="kicker">Un agent demande l'accès</p>
  <h1>Autoriser <span id="clientName">${esc(ctx.client.name)}</span> à rejoindre votre cairn ?</h1>
  <p class="muted">Il agira en votre nom, dans votre organisation seulement, avec vos droits : lire les retex, poser des pierres, caler, commenter. L'accès vaut 30 jours et se révoque dans <i>Mon compte</i> › <i>Connecter un agent IA</i>.</p>
  <div id="login" hidden>
    <label for="email">Adresse e-mail professionnelle</label><input id="email" type="email" autocomplete="username" required>
    <label for="password">Mot de passe</label><input id="password" type="password" autocomplete="current-password" required>
  </div>
  <p id="who" class="muted" hidden></p>
  <p class="msg" id="msg" role="alert"></p>
  <div class="row"><button type="button" id="deny">Refuser</button><button type="button" class="primary" id="ok">Autoriser</button></div>`}
</main>
<script src="https://cdn.jsdelivr.net/npm/pocketbase@0.28.1/dist/pocketbase.umd.js"></script>
<script>
(function () {
  const root = document.getElementById("app"); if (!document.getElementById("ok")) return;
  const P = JSON.parse(root.dataset.params), pb = new PocketBase(location.origin), $ = (s) => document.querySelector(s);
  const msg = (t) => { $("#msg").textContent = t || ""; };
  function refresh() { const ok = pb.authStore.isValid && pb.authStore.record; $("#login").hidden = !!ok; $("#who").hidden = !ok; if (ok) $("#who").textContent = "Connecté en tant que " + (pb.authStore.record.name || pb.authStore.record.email) + "."; }
  refresh();
  $("#deny").onclick = () => { location.replace(P.redirect_uri + (P.redirect_uri.includes("?") ? "&" : "?") + "error=access_denied" + (P.state ? "&state=" + encodeURIComponent(P.state) : "")); };
  $("#ok").onclick = async () => {
    msg(""); $("#ok").disabled = true;
    try {
      if (!(pb.authStore.isValid && pb.authStore.record)) {
        await pb.collection("users").authWithPassword($("#email").value.trim(), $("#password").value);
      }
      const r = await pb.send("/oauth/approve", { method: "POST", body: { client_id: P.client_id, redirect_uri: P.redirect_uri, state: P.state, code_challenge: P.code_challenge, scope: P.scope } });
      location.replace(r.redirect);
    } catch (e) { msg((e && e.response && e.response.message) || (e && e.message) || "Échec de la connexion."); $("#ok").disabled = false; }
  };
})();
</script></body></html>`;
}

module.exports = { SCOPE, noStore, CODE_TTL_S, pkceOk, serverMetadata, resourceMetadata, registerClient, findClient, checkClient, issueCode, consumeCode, withQuery, authorizePage, esc };
