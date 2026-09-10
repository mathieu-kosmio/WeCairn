/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : le chemin vers l'horizon (page d'accueil, sans connexion).
 *
 * GET /api/wecairn/horizon?days=30
 *   -> { days: [{ date, count, tags: [{ tag, n }] }], total, organisations }
 *
 * Agrégat public et anonyme : nombre de pierres posées par jour, toutes organisations
 * confondues, et les tags les plus fréquents du jour. Aucun titre, aucun auteur, aucune
 * organisation n'est exposé. Les tags d'un jour ne sont affichés que si au moins deux
 * pierres ont été posées ce jour-là, pour qu'un tag isolé ne trahisse pas une équipe.
 * Réponse mise en cache par le navigateur cinq minutes.
 */

routerAdd("GET", "/api/wecairn/horizon", (e) => {
  const days = Math.min(90, Math.max(7, parseInt(e.request.url.query().get("days") || "30", 10) || 30));
  const since = new Date(Date.now() - days * 86400000);
  since.setUTCHours(0, 0, 0, 0);
  const sinceIso = since.toISOString().slice(0, 19).replace("T", " ");

  const rows = arrayOf(new DynamicModel({ created: "", tags: "" }));
  $app.db().newQuery("SELECT created, tags FROM retex WHERE created >= {:since} ORDER BY created DESC LIMIT 5000")
    .bind({ since: sinceIso }).all(rows);

  const byDay = {};
  for (const r of rows) {
    const day = String(r.created).slice(0, 10);
    const d = byDay[day] || (byDay[day] = { count: 0, tags: {} });
    d.count++;
    let tags = [];
    try { tags = JSON.parse(String(r.tags || "[]")); } catch (_) { tags = []; }
    if (Array.isArray(tags)) for (const t of tags) { const k = String(t).toLowerCase(); d.tags[k] = (d.tags[k] || 0) + 1; }
  }

  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const d = byDay[date] || { count: 0, tags: {} };
    const tags = d.count >= 2
      ? Object.entries(d.tags).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, n]) => ({ tag, n }))
      : [];
    out.push({ date, count: d.count, tags });
  }

  let organisations = 0;
  try {
    const c = arrayOf(new DynamicModel({ n: 0 }));
    $app.db().newQuery("SELECT COUNT(*) AS n FROM organisations").all(c);
    organisations = c.length ? Number(c[0].n) : 0;
  } catch (_) {}

  e.response.header().set("Cache-Control", "public, max-age=300");
  return e.json(200, { days: out, total: rows.length, organisations });
});
