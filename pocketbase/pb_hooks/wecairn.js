/**
 * Fonctions partagées par les hooks WeCairn (module CommonJS chargé via require()).
 * Les fichiers sans suffixe .pb.js ne sont pas exécutés directement par PocketBase.
 */

const PUBLIC_DOMAINS = ["gmail.com", "googlemail.com", "yahoo.fr", "yahoo.com", "hotmail.com", "hotmail.fr",
  "outlook.com", "outlook.fr", "live.fr", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "free.fr", "orange.fr", "wanadoo.fr", "sfr.fr", "neuf.fr", "bbox.fr", "laposte.net", "gmx.fr", "gmx.com",
  "proton.me", "protonmail.com", "pm.me", "aol.com", "mail.com", "yandex.com"];

function findOrCreateOrganisation(app, domain) {
  try {
    return app.findFirstRecordByFilter("organisations", "domain = {:d}", { d: domain }).id;
  } catch (_) {
    const org = new Record(app.findCollectionByNameOrId("organisations"));
    org.set("name", domain);
    org.set("domain", domain);
    app.save(org);
    return org.id;
  }
}

function normalizeRetex(record) {
  // Un champ json est renvoyé sous forme brute (types.JSONRaw) : on repasse par le texte.
  let tags = [];
  try { tags = JSON.parse(record.getString("tags") || "[]"); } catch (_) { tags = []; }
  if (!Array.isArray(tags)) tags = [];
  const clean = [];
  for (const t of tags) {
    const s = String(t).trim().toLowerCase().slice(0, 40);
    if (s && !clean.includes(s)) clean.push(s);
  }
  record.set("tags", clean.slice(0, 8));
  if (!record.get("source")) record.set("source", "manual");
}

module.exports = { PUBLIC_DOMAINS, findOrCreateOrganisation, normalizeRetex };
