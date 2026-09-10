/**
 * Notifications par e-mail : quand une pierre est posée, les membres de l'organisation sont prévenus ;
 * quand un commentaire arrive, l'auteur de la pierre et ceux qui l'ont calée le sont aussi.
 *
 * Les envois sont différés : une tâche cron (notify.pb.js) passe chaque minute, si bien que publier
 * reste instantané quelle que soit la taille de l'équipe, et que plusieurs commentaires rapprochés sur
 * une même pierre tiennent dans un seul e-mail. Les champs masqués retex.notified et comments.notified
 * servent de file d'attente ; seuls les enregistrements des dernières 24 h sont considérés, pour ne rien
 * rejouer après une longue interruption. Chaque membre peut couper ces e-mails (users.mute_emails).
 * Module CommonJS chargé via require() depuis notify.pb.js ; les gabarits sont des fonctions pures,
 * prévisualisables hors PocketBase.
 */

const WINDOW_HOURS = 24;

const esc = (s) => String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const excerpt = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, "") + "…" : s; };
const listNames = (names) => names.length <= 1 ? (names[0] || "Quelqu'un") : names.slice(0, -1).join(", ") + " et " + names[names.length - 1];

/* ---------- Gabarits : palette sable du thème clair, coin arrondi asymétrique, cairn en tête ---------- */
const FONT = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const SERIF = "'Young Serif', 'Iowan Old Style', Georgia, serif";

function cairnMark(newStone) {
  const stone = (w, h, color, mb) => `<div style="width:${w}px;height:${h}px;background:${color};border-radius:50%;margin:0 auto ${mb}px;"></div>`;
  return `<td width="44" valign="bottom" style="padding-right:10px;">${stone(16, 7, newStone ? "#e0743a" : "#c9c2b5", -2)}${stone(24, 8, "#aaa397", -2)}${stone(32, 9, "#c9c2b5", 0)}</td>`;
}

function label(text) { return `<p style="margin:0 0 4px;font-family:${FONT};font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9e4514;">${esc(text)}</p>`; }
function block(text) { return `<p style="margin:0 0 16px;padding:10px 14px;background:#f1ebdf;border-left:3px solid #c9c2b5;border-radius:0 4px 4px 0;font-family:${FONT};font-size:15px;line-height:1.55;color:#2b2f36;white-space:pre-wrap;">${esc(text)}</p>`; }

/** Enveloppe commune : en-tête WeCairn, carte « pierre plate », bouton lichen, pied discret. */
function layout(o) {
  const kicker = `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9e4514;">${esc(o.kicker)}</p>`;
  const cta = o.ctaURL ? `<p style="margin:22px 0 0;"><a href="${esc(o.ctaURL)}" style="display:inline-block;background:#e0743a;color:#2b1a10;text-decoration:none;font-family:${FONT};font-weight:600;font-size:15px;padding:11px 18px;border-radius:6px 6px 14px 6px;">${esc(o.ctaLabel)}</a></p>` : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#ebe4d6;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ebe4d6;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;">
<tr><td style="padding:0 4px 16px;"><table role="presentation" cellspacing="0" cellpadding="0"><tr>${cairnMark(o.newStone)}<td valign="bottom" style="font-family:${SERIF};font-size:22px;color:#2b2f36;line-height:1;">We<span style="color:#9e4514;">Cairn</span></td></tr></table></td></tr>
<tr><td style="background:#f8f4ec;border-radius:6px 6px 22px 6px;padding:28px 30px;">
${kicker}
<h1 style="margin:0 0 14px;font-family:${SERIF};font-weight:400;font-size:24px;line-height:1.2;color:#2b2f36;">${esc(o.title)}</h1>
<p style="margin:0 0 18px;font-family:${FONT};font-size:15px;line-height:1.55;color:#5c606a;">${o.intro}</p>
${o.body}
${cta}
</td></tr>
<tr><td style="padding:18px 8px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#5c606a;">
<p style="margin:0 0 6px;">${o.footer}</p>
<p style="margin:0;font-family:${SERIF};color:#857f71;">Chaque retex est une pierre posée sur le chemin pour ceux qui suivent.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

const footerFor = (orgName, appName) => `Vous recevez cet e-mail parce que vous faites partie du cairn de <b>${esc(orgName)}</b> sur ${esc(appName)}. Pour ne plus le recevoir, ouvrez <i>Mon compte</i> et décochez « Recevoir les e-mails du cairn ».`;

/** Une pierre vient d'être posée : ctx = { appName, appURL, orgName, authorName, retex: { id, title, situation, learning, recommendation, tags } } */
function renderRetexEmail(ctx) {
  const r = ctx.retex;
  const tags = (r.tags || []).length ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:13px;color:#2f5c75;">Thèmes : ${r.tags.map(esc).join(" · ")}</p>` : "";
  let body = label("Situation") + block(excerpt(r.situation, 320)) + label("Ce qu'on a appris") + block(excerpt(r.learning, 320));
  if (r.recommendation) body += label("Bonne pratique") + block(excerpt(r.recommendation, 240));
  body += tags;
  const subject = `${ctx.authorName} a posé une pierre : ${excerpt(r.title, 80)}`;
  const html = layout({
    newStone: true,
    kicker: `Une pierre posée sur le cairn de ${ctx.orgName}`,
    title: r.title,
    intro: `<b style="color:#2b2f36;">${esc(ctx.authorName)}</b> vient de partager un retour d'expérience. Voici l'essentiel ; si cette pierre vous aide, calez-la.`,
    body,
    ctaURL: ctx.appURL ? `${ctx.appURL}/#retex=${encodeURIComponent(r.id)}` : "",
    ctaLabel: "Lire la pierre",
    footer: footerFor(ctx.orgName, ctx.appName),
  });
  const text = `${ctx.authorName} a posé une pierre sur le cairn de ${ctx.orgName}\n\n${r.title}\n\nSituation : ${excerpt(r.situation, 320)}\n\nCe qu'on a appris : ${excerpt(r.learning, 320)}\n${r.recommendation ? `\nBonne pratique : ${excerpt(r.recommendation, 240)}\n` : ""}${ctx.appURL ? `\nLire la pierre : ${ctx.appURL}/#retex=${encodeURIComponent(r.id)}\n` : ""}\nPour ne plus recevoir ces e-mails : Mon compte > décocher « Recevoir les e-mails du cairn ».`;
  return { subject, html, text };
}

/** Des commentaires sont arrivés (à l'auteur et à ceux qui ont calé) : ctx = { appName, appURL, orgName, isAuthor, retex: { id, title }, comments: [{ authorName, body }] } */
function renderCommentEmail(ctx) {
  const names = []; ctx.comments.forEach((c) => { if (!names.includes(c.authorName)) names.push(c.authorName); });
  const who = listNames(names), verb = names.length > 1 ? "ont commenté" : "a commenté";
  const which = ctx.isAuthor ? "votre pierre" : "une pierre que vous avez calée";
  const subject = `${who} ${verb} ${which} : ${excerpt(ctx.retex.title, 70)}`;
  const body = ctx.comments.map((c) => label(c.authorName) + block(excerpt(c.body, 600))).join("");
  const html = layout({
    newStone: false,
    kicker: ctx.isAuthor ? "Un mot sous votre pierre" : "La discussion continue",
    title: ctx.retex.title,
    intro: `<b style="color:#2b2f36;">${esc(who)}</b> ${verb} ${which}${ctx.comments.length > 1 ? ` (${ctx.comments.length} commentaires)` : ""}.`,
    body,
    ctaURL: ctx.appURL ? `${ctx.appURL}/#retex=${encodeURIComponent(ctx.retex.id)}` : "",
    ctaLabel: "Répondre sur le cairn",
    footer: footerFor(ctx.orgName, ctx.appName),
  });
  const text = `${who} ${verb} ${which} : ${ctx.retex.title}\n\n${ctx.comments.map((c) => `${c.authorName} :\n${excerpt(c.body, 600)}`).join("\n\n")}\n${ctx.appURL ? `\nRépondre : ${ctx.appURL}/#retex=${encodeURIComponent(ctx.retex.id)}\n` : ""}\nPour ne plus recevoir ces e-mails : Mon compte > décocher « Recevoir les e-mails du cairn ».`;
  return { subject, html, text };
}

/* ---------- Traitement de la file (appelé par le cron) ---------- */
function meta(app) {
  const m = app.settings().meta;
  return { appName: String(m.appName || "WeCairn"), appURL: String(m.appURL || "").replace(/\/+$/, ""), from: { address: m.senderAddress, name: m.senderName } };
}

function send(app, m, user, mail) {
  try {
    const message = new MailerMessage({ from: m.from, to: [{ address: user.get("email"), name: user.get("name") }], subject: mail.subject, html: mail.html, text: mail.text });
    app.newMailClient().send(message);
  } catch (err) {
    app.logger().warn("WeCairn : échec d'envoi d'une notification", "to", user.get("email"), "subject", mail.subject, "error", String(err));
  }
}

const sinceIso = () => new Date(Date.now() - WINDOW_HOURS * 3600000).toISOString().replace("T", " ").slice(0, 19);
const markNotified = (app, table, id) => app.db().newQuery(`UPDATE ${table} SET notified = 1 WHERE id = {:id}`).bind({ id }).execute();

function userCache(app) {
  const cache = {};
  return (id) => { if (!(id in cache)) { try { cache[id] = app.findRecordById("users", id); } catch (_) { cache[id] = null; } } return cache[id]; };
}

function notifyRetex(app, m) {
  const rows = app.findRecordsByFilter("retex", "notified = false && created >= {:since}", "created", 100, 0, { since: sinceIso() });
  for (const r of rows) {
    markNotified(app, "retex", r.id);
    let org, author;
    try { org = app.findRecordById("organisations", r.get("organisation")); author = app.findRecordById("users", r.get("author")); } catch (_) { continue; }
    const members = app.findRecordsByFilter("users", "organisation = {:org} && id != {:me} && mute_emails = false", "name", 500, 0, { org: org.id, me: author.id });
    if (!members.length) continue;
    let tags = []; try { tags = JSON.parse(String(r.get("tags") || "[]")); } catch (_) {}
    const mail = renderRetexEmail({ appName: m.appName, appURL: m.appURL, orgName: org.get("name"), authorName: author.get("name"),
      retex: { id: r.id, title: r.get("title"), situation: r.get("situation"), learning: r.get("learning"), recommendation: r.get("recommendation"), tags: Array.isArray(tags) ? tags : [] } });
    for (const u of members) send(app, m, u, mail);
  }
}

function notifyComments(app, m) {
  const rows = app.findRecordsByFilter("comments", "notified = false && created >= {:since}", "created", 200, 0, { since: sinceIso() });
  const byRetex = {};
  for (const c of rows) { markNotified(app, "comments", c.id); (byRetex[c.get("retex")] = byRetex[c.get("retex")] || []).push(c); }
  const getUser = userCache(app);
  for (const retexId of Object.keys(byRetex)) {
    let r, org;
    try { r = app.findRecordById("retex", retexId); org = app.findRecordById("organisations", r.get("organisation")); } catch (_) { continue; }
    const batch = byRetex[retexId];
    // Destinataires : l'auteur de la pierre et ceux qui l'ont calée, jamais pour leurs propres mots
    const participants = [r.get("author")];
    for (const v of app.findRecordsByFilter("votes", "retex = {:r}", "created", 500, 0, { r: retexId })) { const u = v.get("user"); if (!participants.includes(u)) participants.push(u); }
    for (const pid of participants) {
      const mine = batch.filter((c) => c.get("author") !== pid);
      if (!mine.length) continue;
      const u = getUser(pid);
      if (!u || u.get("mute_emails") || u.get("organisation") !== org.id) continue;
      const mail = renderCommentEmail({ appName: m.appName, appURL: m.appURL, orgName: org.get("name"), isAuthor: pid === r.get("author"),
        retex: { id: r.id, title: r.get("title") },
        comments: mine.map((c) => { const a = getUser(c.get("author")); return { authorName: a ? a.get("name") : "Un membre", body: c.get("body") }; }) });
      send(app, m, u, mail);
    }
  }
}

function run(app) {
  const m = meta(app);
  notifyRetex(app, m);
  notifyComments(app, m);
}

module.exports = { run, renderRetexEmail, renderCommentEmail };
