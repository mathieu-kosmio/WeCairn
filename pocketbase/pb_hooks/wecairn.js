/**
 * Fonctions partagées par les hooks WeCairn (module CommonJS chargé via require()).
 * Les fichiers sans suffixe .pb.js ne sont pas exécutés directement par PocketBase.
 */

const PUBLIC_DOMAINS = ["gmail.com", "googlemail.com", "yahoo.fr", "yahoo.com", "hotmail.com", "hotmail.fr",
  "outlook.com", "outlook.fr", "live.fr", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "free.fr", "orange.fr", "wanadoo.fr", "sfr.fr", "neuf.fr", "bbox.fr", "laposte.net", "gmx.fr", "gmx.com",
  "proton.me", "protonmail.com", "pm.me", "aol.com", "mail.com", "yandex.com",
  "web.de", "gmx.de", "gmx.net", "t-online.de", "tutanota.com", "tuta.io", "tutamail.com", "zoho.com", "fastmail.com",
  "hey.com", "mail.ru", "yandex.ru", "qq.com", "163.com", "skynet.be", "bluewin.ch"];

// Familles de messageries déclinées par pays (yahoo.co.uk, outlook.de, proton.ch…) : refusées quel que soit le suffixe.
const PUBLIC_FAMILIES = ["gmail", "googlemail", "yahoo", "hotmail", "outlook", "live", "msn", "icloud", "gmx", "proton",
  "protonmail", "yandex", "aol", "tutanota", "tuta"];

/**
 * Domaine de rattachement d'une adresse e-mail, ou une erreur en français. L'adresse est normalisée (minuscules,
 * point final retiré) ; seuls les domaines ASCII sont acceptés, pour qu'un domaine visuellement identique à celui
 * d'un client (caractères Unicode) ne crée pas une organisation trompeuse.
 * Retourne { email, domain } ou { error }.
 */
function memberDomain(rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase().replace(/\.+$/, "");
  const at = email.lastIndexOf("@");
  const domain = at > 0 ? email.slice(at + 1) : "";
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return { error: "Adresse e-mail invalide." };
  const labels = domain.split(".");
  const family = labels.length <= 3 && PUBLIC_FAMILIES.includes(labels[0]) && (labels.length === 2 || labels[1].length <= 3);
  if (PUBLIC_DOMAINS.includes(domain) || family) {
    return { error: "Utilisez votre adresse e-mail professionnelle : l'organisation est déduite de son domaine." };
  }
  return { email, domain };
}

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

module.exports = { PUBLIC_DOMAINS, PUBLIC_FAMILIES, memberDomain, findOrCreateOrganisation, normalizeRetex };
