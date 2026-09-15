/**
 * WeCairn : tests d'intégration contre une instance PocketBase jetable (lancée par scripts/test.sh).
 *
 * Le schéma est importé au démarrage (before) via l'API superutilisateur, comme en production
 * (import manuel des collections). Aucune dépendance : node:test, fetch et node:fs.
 * Lancer avec `make test`.
 *
 * Couvre pour cette phase : import du schéma, rattachement par domaine, isolation entre organisations,
 * règles d'accès de base, normalisation des pierres, détection superadmin, et surtout la protection
 * contre la prise de contrôle d'un superutilisateur par un compte membre de même e-mail.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";

const BASE = process.env.PB_URL || "http://127.0.0.1:8090";
const ADMIN = { identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD };
const FAKE_AI_PORT = Number(process.env.PB_FAKE_AI_PORT || 0);
const RUN = randomBytes(3).toString("hex");

/* ---------- Petit client HTTP ---------- */
async function api(method, path, { token, body, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = token;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual" });
  const text = await res.text();
  let data = text;
  if (!raw) { try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; } }
  return { status: res.status, data, headers: res.headers };
}
const records = (col) => `/api/collections/${col}/records`;

async function signup(email, name, extra = {}) {
  return api("POST", records("users"), { body: { email, password: "password-123", passwordConfirm: "password-123", name, ...extra } });
}
/** Marque un membre comme vérifié via l'API superutilisateur. */
async function verify(email) {
  const r = await api("GET", `${records("users")}?filter=${encodeURIComponent(`email = "${email}"`)}`, { token: admin });
  assert.equal(r.data.items.length, 1, `membre ${email}`);
  const u = await api("PATCH", `${records("users")}/${r.data.items[0].id}`, { token: admin, body: { verified: true } });
  assert.equal(u.status, 200);
}
async function login(email) {
  const r = await api("POST", "/api/collections/users/auth-with-password", { body: { identity: email, password: "password-123" } });
  assert.equal(r.status, 200, `connexion ${email} : ${JSON.stringify(r.data)}`);
  return { token: r.data.token, user: r.data.record };
}
async function mcp(key, method, params = {}, id = 1) {
  return api("POST", "/mcp", { token: key ? `Bearer ${key}` : undefined, body: { jsonrpc: "2.0", id, method, params } });
}
const newRetex = (u, over = {}) => ({
  organisation: u.user.organisation, author: u.user.id,
  title: "Cadrer les données avant l'atelier",
  situation: "Atelier lancé sans périmètre clair.",
  learning: "Deux jours perdus faute de cadrage.",
  recommendation: "Cadrer les données en amont.",
  tags: ["Atelier", "données", "atelier"], ...over,
});

/* ---------- Faux fournisseur IA (compatible OpenAI), aucune clé réelle ---------- */
let fakeAI;
const aiCalls = [];

/* ---------- Fixtures ---------- */
let admin, alice, bob, carol, key;
const acme = `acme-${RUN}.test`, other = `other-${RUN}.test`;

before(async () => {
  const r = await api("POST", "/api/collections/_superusers/auth-with-password", { body: ADMIN });
  assert.equal(r.status, 200, "authentification superutilisateur");
  admin = r.data.token;

  // Le schéma est importé et durci par les migrations au démarrage (voir pocketbase/pb_migrations/).

  for (const [email, name] of [[`alice@${acme}`, "Alice"], [`bob@${acme}`, "Bob"], [`carol@${other}`, "Carol"]]) {
    const s = await signup(email, name);
    assert.equal(s.status, 200, `inscription ${email} : ${JSON.stringify(s.data)}`);
    await verify(email);
  }
  alice = await login(`alice@${acme}`);
  bob = await login(`bob@${acme}`);
  carol = await login(`carol@${other}`);

  const k = await api("POST", "/api/wecairn/keys", { token: alice.token, body: { name: "Agent de test" } });
  assert.ok(k.data.key, `clé MCP d'Alice : ${JSON.stringify(k.data)}`);
  key = k.data.key;

  if (FAKE_AI_PORT) {
    fakeAI = createServer((req, res) => {
      let chunks = "";
      req.on("data", (c) => { chunks += c; });
      req.on("end", () => {
        aiCalls.push({ url: req.url, auth: req.headers.authorization });
        res.setHeader("Content-Type", "application/json");
        if (req.url.endsWith("/chat/completions")) {
          const content = JSON.stringify({ title: "Titre extrait", situation: "Situation.", learning: "Enseignement.", recommendation: "Bonne pratique.", tags: ["IA", "Test", "ia"], questions: ["Quel projet ?", "Quand ?"] });
          res.end(JSON.stringify({ choices: [{ message: { content } }] }));
        } else if (req.url.endsWith("/audio/transcriptions")) {
          res.end(JSON.stringify({ text: "Voici mon récit." }));
        } else { res.statusCode = 404; res.end("{}"); }
      });
    });
    await new Promise((ok) => fakeAI.listen(FAKE_AI_PORT, "127.0.0.1", ok));
  }
});

after(async () => { if (fakeAI) await new Promise((ok) => fakeAI.close(ok)); });

/* ---------- Schéma et inscription ---------- */
test("l'import charge toutes les collections", async () => {
  const r = await api("GET", "/api/collections?perPage=100", { token: admin });
  const names = r.data.items.map((c) => c.name);
  for (const n of ["organisations", "users", "retex", "votes", "comments", "api_keys", "oauth_clients", "retex_feed", "leaderboard"]) assert.ok(names.includes(n), n);
});

test("inscription refusée avec une messagerie grand public", async () => {
  const r = await signup(`dave-${RUN}@gmail.com`, "Dave");
  assert.equal(r.status, 400);
});

test("le client ne peut pas choisir son organisation", async () => {
  const r = await signup(`eve@${acme}`, "Eve", { organisation: carol.user.organisation });
  // Le membre est rattaché à SON domaine, jamais à l'organisation demandée.
  if (r.status === 200) {
    assert.notEqual(r.data.organisation, carol.user.organisation);
  } else {
    assert.equal(r.status, 400);
  }
});

test("rattachement par domaine : même domaine, même organisation", async () => {
  assert.ok(alice.user.organisation);
  assert.equal(alice.user.organisation, bob.user.organisation);
  assert.notEqual(alice.user.organisation, carol.user.organisation);
  const org = await api("GET", `${records("organisations")}/${alice.user.organisation}`, { token: alice.token });
  assert.equal(org.data.domain, acme);
  assert.equal(org.data.ai_api_key, undefined, "la clé IA reste masquée");
});

/* ---------- Prise de contrôle : le test central de la phase 1 ---------- */
test("prise de contrôle du superutilisateur impossible via un compte membre de même e-mail", async () => {
  // Un attaquant s'inscrit avec l'e-mail de l'administrateur et un mot de passe de son choix.
  const attack = await api("POST", records("users"), { body: { email: ADMIN.identity, password: "attacker-pass-1", passwordConfirm: "attacker-pass-1", name: "Mallory" } });
  assert.equal(attack.status, 200);
  // La console ne doit jamais accepter le mot de passe de l'attaquant.
  assert.notEqual((await api("POST", "/api/collections/_superusers/auth-with-password", { body: { identity: ADMIN.identity, password: "attacker-pass-1" } })).status, 200, "console intacte après l'inscription");
  // L'ancien mot de passe de la console fonctionne toujours (il n'a pas été écrasé).
  assert.equal((await api("POST", "/api/collections/_superusers/auth-with-password", { body: ADMIN })).status, 200, "l'inscription n'a pas touché la console");

  // Même vérifié, un compte membre n'écrit jamais le mot de passe de la console : c'est la console qui aligne le membre.
  await api("PATCH", `${records("users")}/${attack.data.id}`, { token: admin, body: { verified: true } });
  assert.notEqual((await api("POST", "/api/collections/_superusers/auth-with-password", { body: { identity: ADMIN.identity, password: "attacker-pass-1" } })).status, 200, "console toujours intacte après vérification");

  // Une connexion réussie côté console aligne le membre jumeau vérifié sur le mot de passe de la console.
  assert.equal((await api("POST", "/api/collections/_superusers/auth-with-password", { body: ADMIN })).status, 200);
  const member = await api("POST", "/api/collections/users/auth-with-password", { body: ADMIN });
  assert.equal(member.status, 200, "le membre jumeau vérifié a reçu le mot de passe de la console");
  const me = await api("GET", "/api/wecairn/me", { token: member.data.token });
  assert.deepEqual(me.data, { superadmin: true });

  // Un changement de mot de passe côté membre ne remonte jamais vers la console.
  await api("PATCH", `${records("users")}/${member.data.record.id}`, { token: member.data.token, body: { oldPassword: ADMIN.password, password: "changed-by-member-1", passwordConfirm: "changed-by-member-1" } });
  assert.equal((await api("POST", "/api/collections/_superusers/auth-with-password", { body: ADMIN })).status, 200, "le changement côté membre ne touche pas la console");
});

test("GET /api/wecairn/me indique si le membre est superutilisateur", async () => {
  const r = await api("GET", "/api/wecairn/me", { token: alice.token });
  assert.deepEqual(r.data, { superadmin: false });
  assert.equal((await api("GET", "/api/wecairn/me")).status, 401);
});

/* ---------- Vérification des adresses (phase 2) ---------- */
test("connexion refusée tant que l'adresse n'est pas vérifiée", async () => {
  const email = `frank@${acme}`;
  assert.equal((await signup(email, "Frank")).status, 200);
  const r = await api("POST", "/api/collections/users/auth-with-password", { body: { identity: email, password: "password-123" } });
  assert.notEqual(r.status, 200, "un compte non vérifié ne doit pas pouvoir se connecter");
  await verify(email);
  await login(email);
});

test("la collection users exige une adresse vérifiée pour se connecter", async () => {
  const r = await api("GET", "/api/collections/users", { token: admin });
  assert.equal(r.data.authRule, "verified = true");
});

test("un membre ne peut pas se marquer lui-même comme vérifié", async () => {
  const email = `grace@${acme}`;
  const created = await signup(email, "Grace", { verified: true });
  // Le champ verified envoyé à l'inscription est ignoré : le compte reste non vérifié.
  if (created.status === 200) {
    const r = await api("POST", "/api/collections/users/auth-with-password", { body: { identity: email, password: "password-123" } });
    assert.notEqual(r.status, 200, "verified fourni à l'inscription est ignoré");
  } else {
    assert.equal(created.status, 400);
  }
  // Un membre connecté ne peut pas non plus changer son propre statut.
  await api("PATCH", `${records("users")}/${bob.user.id}`, { token: bob.token, body: { verified: false } });
  const after = await api("GET", `${records("users")}/${bob.user.id}`, { token: admin });
  assert.equal(after.data.verified, true, "verified reste géré par l'administration");
});

test("MCP : la clé d'un membre non vérifié est refusée", async () => {
  const email = `heidi@${acme}`;
  assert.equal((await signup(email, "Heidi")).status, 200);
  await verify(email);
  const heidi = await login(email);
  const k = await api("POST", "/api/wecairn/keys", { token: heidi.token, body: { name: "Agent de Heidi" } });
  assert.ok(k.data.key, `clé émise : ${JSON.stringify(k.data)}`);
  assert.equal((await mcp(k.data.key, "ping")).status, 200);
  // Cas d'une base antérieure à la vérification obligatoire : clé émise, adresse jamais confirmée.
  await api("PATCH", `${records("users")}/${heidi.user.id}`, { token: admin, body: { verified: false } });
  assert.equal((await mcp(k.data.key, "ping")).status, 401, "une clé n'ouvre rien tant que l'adresse n'est pas vérifiée");
});

/* ---------- Durcissement : domaines et adresses (phase 3) ---------- */
test("adresse insensible à la casse : pas de doublon d'un membre existant", async () => {
  const dup = await signup(`ALICE@${acme.toUpperCase()}`, "Fausse Alice");
  assert.equal(dup.status, 400, "ALICE@ACME doublait alice@acme");
  assert.equal((await signup(`Ivan@${acme}`, "Ivan")).status, 200);
  const r = await api("GET", `${records("users")}?filter=${encodeURIComponent(`email = "ivan@${acme}"`)}`, { token: admin });
  assert.equal(r.data.items.length, 1, "adresse enregistrée en minuscules");
});

test("messageries grand public refusées sous toutes leurs formes", async () => {
  for (const email of [`judy-${RUN}@gmail.com.`, `judy-${RUN}@yahoo.co.uk`, `judy-${RUN}@outlook.de`, `judy-${RUN}@web.de`, `judy-${RUN}@exämple.fr`]) {
    assert.equal((await signup(email, "Judy")).status, 400, email);
  }
});

test("changement d'adresse : le domaine de l'organisation est conservé", async () => {
  const refused = /domaine de votre organisation/;
  const away = await api("POST", "/api/collections/users/request-email-change", { token: bob.token, body: { newEmail: `bob@${other}` } });
  assert.equal(away.status, 400, "changer de domaine garderait l'accès à l'ancienne organisation");
  assert.match(JSON.stringify(away.data), refused);
  // Même domaine : accepté par le hook. Sans canal d'e-mail (CI), PocketBase peut ensuite échouer à l'envoi.
  const same = await api("POST", "/api/collections/users/request-email-change", { token: bob.token, body: { newEmail: `robert@${acme}` } });
  assert.ok(same.status === 204 || !refused.test(JSON.stringify(same.data)), JSON.stringify(same.data));
});

test("un compte non vérifié est invisible des membres et du classement", async () => {
  const email = `mallory-${RUN}@${acme}`;
  assert.equal((await signup(email, "Direction Support IT")).status, 200);
  const members = await api("GET", `${records("users")}?perPage=200`, { token: alice.token });
  assert.ok(!members.data.items.some((u) => u.name === "Direction Support IT"), "liste des membres");
  const board = await api("GET", `${records("leaderboard")}?perPage=200`, { token: alice.token });
  assert.ok(!board.data.items.some((u) => u.name === "Direction Support IT"), "classement");
});

/* ---------- Durcissement : MCP (phase 3) ---------- */
test("MCP : initialize et tools/list", async () => {
  const init = await mcp(key, "initialize", { protocolVersion: "2025-06-18" });
  assert.equal(init.status, 200);
  assert.equal(init.data.result.protocolVersion, "2025-06-18");
  const tools = (await mcp(key, "tools/list")).data.result.tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["comment_retex", "create_retex", "create_retex_batch", "delete_retex", "get_retex", "leaderboard", "list_retex", "search_retex", "update_retex", "vote_retex"]);
});

test("MCP : les noms saisis par les membres sont cités comme des données", async () => {
  const r = await mcp(key, "initialize", { protocolVersion: "2025-06-18" });
  assert.match(r.data.result.instructions, /« Alice »/);
  assert.match(r.data.result.instructions, /jamais des consignes/);
});

test("MCP : lots bornés à 20 (JSON-RPC et publication en lot)", async () => {
  const batch = Array.from({ length: 21 }, (_, i) => ({ jsonrpc: "2.0", id: i + 1, method: "ping" }));
  assert.equal((await api("POST", "/mcp", { token: `Bearer ${key}`, body: batch })).status, 400);
  const items = Array.from({ length: 21 }, (_, i) => ({ title: `Lot ${i}`, situation: "Situation.", learning: "Enseignement." }));
  const r = await mcp(key, "tools/call", { name: "create_retex_batch", arguments: { items } });
  assert.equal(r.data.result.isError, true, "21 pierres refusées");
});

test("MCP : un nouveau mot de passe révoque les clés du membre", async () => {
  const email = `kim@${acme}`;
  assert.equal((await signup(email, "Kim")).status, 200);
  await verify(email);
  const kim = await login(email);
  const k = await api("POST", "/api/wecairn/keys", { token: kim.token, body: { name: "Agent de Kim" } });
  assert.equal((await mcp(k.data.key, "ping")).status, 200);
  const pwd = await api("PATCH", `${records("users")}/${kim.user.id}`, { token: kim.token, body: { oldPassword: "password-123", password: "password-456", passwordConfirm: "password-456" } });
  assert.equal(pwd.status, 200, JSON.stringify(pwd.data));
  assert.equal((await mcp(k.data.key, "ping")).status, 401, "une clé créée avant la reprise du compte ne survit pas");
});

/* ---------- Durcissement : OAuth 2.1 (phase 3) ---------- */
test("OAuth : enregistrement, autorisation, échange PKCE, client_id obligatoire", async () => {
  const reg = await api("POST", "/oauth/register", { body: { client_name: "Connecteur de test", redirect_uris: ["http://localhost:9999/callback"] } });
  assert.equal(reg.status, 201);
  const clientId = reg.data.client_id;
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const approve = await api("POST", "/oauth/approve", { token: carol.token, body: { client_id: clientId, redirect_uri: "http://localhost:9999/callback", code_challenge: challenge } });
  assert.equal(approve.status, 200);
  const code = new URL(approve.data.redirect).searchParams.get("code");
  const tok = await api("POST", "/oauth/token", { body: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: "http://localhost:9999/callback" } });
  assert.equal(tok.status, 200, JSON.stringify(tok.data));

  const approve2 = await api("POST", "/oauth/approve", { token: carol.token, body: { client_id: clientId, redirect_uri: "http://localhost:9999/callback", code_challenge: challenge } });
  const code2 = new URL(approve2.data.redirect).searchParams.get("code");
  const noClient = await api("POST", "/oauth/token", { body: { grant_type: "authorization_code", code: code2, code_verifier: verifier } });
  assert.equal(noClient.status, 400, "client_id obligatoire à l'échange");
});

test("OAuth : adresses de retour trompeuses refusées, hôte inconnu signalé", async () => {
  for (const uri of ["https://claude.ai@evil.example/cb", "https://evil.example/cb#frag", "https://*.evil.example/cb", "javascript:alert(1)", "http://evil.example/cb"]) {
    const r = await api("POST", "/oauth/register", { body: { client_name: "Claude", redirect_uris: [uri] } });
    assert.equal(r.status, 400, uri);
  }
  const many = await api("POST", "/oauth/register", { body: { client_name: "Claude", redirect_uris: Array.from({ length: 6 }, (_, i) => `https://a${i}.example/cb`) } });
  assert.equal(many.status, 400, "cinq adresses au plus");

  const reg = await api("POST", "/oauth/register", { body: { client_name: "Claude", redirect_uris: ["https://attacker.example/cb"] } });
  assert.equal(reg.status, 201);
  const page = await api("GET", `/oauth/authorize?response_type=code&client_id=${reg.data.client_id}&redirect_uri=${encodeURIComponent("https://attacker.example/cb")}&code_challenge=abc&code_challenge_method=S256`, { raw: true });
  assert.match(page.data, /<strong>attacker\.example<\/strong>/);
  assert.match(page.data, /class="warn"/);
});

/* ---------- Durcissement : dictée (phase 3) ---------- */
test("IA : dictée, seuls les formats audio partent chez le fournisseur", { skip: !FAKE_AI_PORT && "PB_FAKE_AI_PORT absent" }, async () => {
  const set = await api("PATCH", `${records("organisations")}/${bob.user.organisation}`, { token: admin, body: { ai_provider: "mistral", ai_api_key: "cle-de-test" } });
  assert.equal(set.status, 200);

  const ok = new FormData();
  ok.append("audio", new Blob([randomBytes(64)], { type: "audio/webm" }), "audio.webm");
  ok.append("transcript", "Début du récit.");
  const dict = await api("POST", "/api/wecairn/ai/dictate", { token: bob.token, body: ok });
  assert.equal(dict.status, 200, JSON.stringify(dict.data));
  assert.match(String(dict.data.transcript), /Voici mon récit\./);

  const html = new FormData();
  html.append("audio", new Blob(["<html></html>"], { type: "text/html" }), "page.html");
  assert.equal((await api("POST", "/api/wecairn/ai/dictate", { token: bob.token, body: html })).status, 400, "un fichier non audio est refusé");
});

/* ---------- Pierres : règles d'accès de base ---------- */
test("création au nom de soi-même, tags normalisés", async () => {
  const r = await api("POST", records("retex"), { token: alice.token, body: newRetex(alice) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.tags, ["atelier", "données"]);
  assert.equal(r.data.source, "manual");
});

test("impossible de poser une pierre au nom d'un autre ou dans une autre organisation", async () => {
  const asOther = await api("POST", records("retex"), { token: bob.token, body: newRetex(alice) });
  assert.equal(asOther.status, 400);
  const otherOrg = await api("POST", records("retex"), { token: carol.token, body: newRetex(carol, { organisation: alice.user.organisation }) });
  assert.equal(otherOrg.status, 400);
});

test("isolation : une organisation ne lit pas les pierres d'une autre", async () => {
  await api("POST", records("retex"), { token: alice.token, body: newRetex(alice, { title: `Secret ${RUN}` }) });
  const seen = await api("GET", `${records("retex")}?perPage=200`, { token: carol.token });
  assert.ok(!seen.data.items.some((r) => r.title === `Secret ${RUN}`), "carol ne voit pas les pierres d'acme");
});
