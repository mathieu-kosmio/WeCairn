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
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = process.env.PB_URL || "http://127.0.0.1:8090";
const ADMIN = { identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD };
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
const newRetex = (u, over = {}) => ({
  organisation: u.user.organisation, author: u.user.id,
  title: "Cadrer les données avant l'atelier",
  situation: "Atelier lancé sans périmètre clair.",
  learning: "Deux jours perdus faute de cadrage.",
  recommendation: "Cadrer les données en amont.",
  tags: ["Atelier", "données", "atelier"], ...over,
});

/* ---------- Fixtures ---------- */
let admin, alice, bob, carol;
const acme = `acme-${RUN}.test`, other = `other-${RUN}.test`;

before(async () => {
  const r = await api("POST", "/api/collections/_superusers/auth-with-password", { body: ADMIN });
  assert.equal(r.status, 200, "authentification superutilisateur");
  admin = r.data.token;

  // Import du schéma comme en production (merge, sans supprimer les collections système).
  const collections = JSON.parse(readFileSync("pocketbase/pb_schema.json", "utf8"));
  const imp = await api("PUT", "/api/collections/import", { token: admin, body: { collections, deleteMissing: false } });
  assert.ok(imp.status >= 200 && imp.status < 300, `import du schéma : ${imp.status} ${JSON.stringify(imp.data)}`);

  for (const [email, name] of [[`alice@${acme}`, "Alice"], [`bob@${acme}`, "Bob"], [`carol@${other}`, "Carol"]]) {
    const s = await signup(email, name);
    assert.equal(s.status, 200, `inscription ${email} : ${JSON.stringify(s.data)}`);
    await verify(email);
  }
  alice = await login(`alice@${acme}`);
  bob = await login(`bob@${acme}`);
  carol = await login(`carol@${other}`);
});

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
