/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : le chemin vers l'horizon (page d'accueil, sans connexion).
 *
 * GET /api/wecairn/horizon?days=30
 *   -> { days: [{ date, count, tags: [{ tag, n }] }], total, organisations }
 *
 * Agrégat public et anonyme : nombre de pierres posées par jour, toutes organisations
 * confondues, et les tags les plus fréquents du jour. Aucun titre, aucun auteur, aucune
 * organisation n'est exposé. Un tag n'est donné que s'il a été utilisé le même jour par au
 * moins MIN_ORGS organisations distinctes : un tag propre à une équipe (nom de projet, de
 * client) ne sort jamais. Le nombre d'organisations ne compte que celles qui ont au moins un
 * membre vérifié. Réponse mise en cache par le navigateur cinq minutes.
 */

routerAdd("GET", "/api/wecairn/horizon", (e) => {
  const MIN_ORGS = 3;
  const days = Math.min(90, Math.max(7, parseInt(e.request.url.query().get("days") || "30", 10) || 30));
  const since = new Date(Date.now() - days * 86400000);
  since.setUTCHours(0, 0, 0, 0);
  const sinceIso = since.toISOString().slice(0, 19).replace("T", " ");

  const rows = arrayOf(new DynamicModel({ created: "", tags: "", organisation: "" }));
  $app.db().newQuery("SELECT created, tags, organisation FROM retex WHERE created >= {:since} ORDER BY created DESC LIMIT 5000")
    .bind({ since: sinceIso }).all(rows);

  const byDay = {};
  for (const r of rows) {
    const day = String(r.created).slice(0, 10);
    const d = byDay[day] || (byDay[day] = { count: 0, tags: {} });
    d.count++;
    let tags = [];
    try { tags = JSON.parse(String(r.tags || "[]")); } catch (_) { tags = []; }
    if (Array.isArray(tags)) for (const t of tags) {
      const k = String(t).toLowerCase(), s = d.tags[k] || (d.tags[k] = { n: 0, orgs: {} });
      s.n++; s.orgs[String(r.organisation)] = true;
    }
  }

  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const d = byDay[date] || { count: 0, tags: {} };
    const tags = Object.entries(d.tags)
      .filter(([, s]) => Object.keys(s.orgs).length >= MIN_ORGS)
      .sort((a, b) => b[1].n - a[1].n).slice(0, 5).map(([tag, s]) => ({ tag, n: s.n }));
    out.push({ date, count: d.count, tags });
  }

  let organisations = 0;
  try {
    const c = arrayOf(new DynamicModel({ n: 0 }));
    $app.db().newQuery("SELECT COUNT(DISTINCT organisation) AS n FROM users WHERE verified = TRUE AND organisation != ''").all(c);
    organisations = c.length ? Number(c[0].n) : 0;
  } catch (_) {}

  e.response.header().set("Cache-Control", "public, max-age=300");
  return e.json(200, { days: out, total: rows.length, organisations });
});
