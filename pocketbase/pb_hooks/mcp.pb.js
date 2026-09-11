/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : serveur MCP distant et clés d'API personnelles (voir mcp.js).
 *
 *   POST /mcp                      serveur MCP (Streamable HTTP, sans état), « Authorization: Bearer wc_… »
 *   GET  /mcp                      description JSON pour un agent qui explore (405 si un flux SSE est demandé)
 *   GET  /llms.txt                 mode d'emploi lisible par les agents : adresse, clé, configuration, outils
 *   GET  /.well-known/mcp.json     même description, lisible par machine
 *   POST /api/wecairn/keys         (membre connecté) génère une clé valable 30 jours, renvoyée une seule fois
 *
 * La liste et la révocation des clés passent par la collection api_keys (règles : ses propres clés).
 */

routerAdd("POST", "/mcp", (e) => {
  const mcp = require(`${__hooks}/mcp.js`);
  const base = mcp.baseURL($app, e), appName = String($app.settings().meta.appName || "WeCairn");
  const key = String(e.request.header.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const user = key ? mcp.userForKey($app, key) : null;
  if (!user) {
    e.response.header().set("WWW-Authenticate", `Bearer realm="WeCairn", error="invalid_token", resource_metadata="${base}/.well-known/oauth-protected-resource"`);
    return e.json(401, {
      error: "unauthorized",
      message: `Clé d'API ${key ? "invalide ou expirée" : "manquante"}. Ce serveur MCP attend l'en-tête « Authorization: Bearer <clé> ».`,
      how_to_get_key: `Demandez à l'utilisateur d'ouvrir ${base}, de se connecter, puis menu utilisateur > « Connecter un agent (MCP) » > « Générer une clé » (valable ${mcp.KEY_DAYS} jours), et de vous coller la clé.`,
      oauth: `Les clients OAuth (connecteurs claude.ai, ChatGPT…) découvrent le flux via ${base}/.well-known/oauth-authorization-server ; l'utilisateur autorise l'agent dans son navigateur, sans clé à coller.`,
      documentation: `${base}/llms.txt`,
    });
  }
  let orgName = "votre organisation";
  try { orgName = $app.findRecordById("organisations", user.get("organisation")).get("name"); } catch (_) {}
  const me = { id: user.id, organisation: user.get("organisation"), name: user.get("name") };
  let c = null;
  const ctx = { me, orgName, appName, client: () => c || (c = mcp.client($app, user)) };
  const out = mcp.handleBody($app, toString(e.request.body), ctx);
  if (out.body === null) return e.noContent(202);
  return e.json(out.status, out.body);
});

routerAdd("GET", "/mcp", (e) => {
  const mcp = require(`${__hooks}/mcp.js`);
  if (/text\/event-stream/i.test(String(e.request.header.get("Accept") || ""))) {
    e.response.header().set("Allow", "POST");
    return e.json(405, { error: "stateless", message: "Ce serveur MCP est sans état : pas de flux SSE, envoyez vos requêtes JSON-RPC en POST." });
  }
  return e.json(200, mcp.helpJSON(mcp.baseURL($app, e), String($app.settings().meta.appName || "WeCairn")));
});

routerAdd("DELETE", "/mcp", (e) => { e.response.header().set("Allow", "POST"); return e.json(405, { error: "stateless" }); });

routerAdd("GET", "/llms.txt", (e) => {
  const mcp = require(`${__hooks}/mcp.js`);
  return e.string(200, mcp.llmsTxt(mcp.baseURL($app, e), String($app.settings().meta.appName || "WeCairn")));
});

routerAdd("GET", "/.well-known/mcp.json", (e) => {
  const mcp = require(`${__hooks}/mcp.js`);
  return e.json(200, mcp.helpJSON(mcp.baseURL($app, e), String($app.settings().meta.appName || "WeCairn")));
});

routerAdd("POST", "/api/wecairn/keys", (e) => {
  const mcp = require(`${__hooks}/mcp.js`);
  let name = "";
  try { name = String((e.requestInfo().body || {}).name || ""); } catch (_) {}
  return e.json(200, mcp.createKey($app, e.auth, name));
}, $apis.requireAuth("users"));
