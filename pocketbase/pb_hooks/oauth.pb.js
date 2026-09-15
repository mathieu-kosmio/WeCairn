/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : routes OAuth 2.1 devant le serveur MCP (voir oauth.js).
 *
 *   GET  /.well-known/oauth-authorization-server   métadonnées du serveur d'autorisation (RFC 8414)
 *   GET  /.well-known/oauth-protected-resource[/mcp] métadonnées de la ressource protégée (RFC 9728)
 *   POST /oauth/register                           enregistrement dynamique d'un client (RFC 7591)
 *   GET  /oauth/authorize                          page d'autorisation (connexion WeCairn + consentement)
 *   POST /oauth/approve                            (membre connecté) délivre le code et l'adresse de retour
 *   POST /oauth/token                              échange code + PKCE contre une clé personnelle 30 jours
 */

// Note : pas de fonction au niveau du fichier, chaque handler tourne dans une VM isolée (helpers dans oauth.js).

routerAdd("GET", "/.well-known/oauth-authorization-server", (e) => e.json(200, require(`${__hooks}/oauth.js`).serverMetadata(require(`${__hooks}/mcp.js`).baseURL($app, e))));
routerAdd("GET", "/.well-known/oauth-protected-resource", (e) => e.json(200, require(`${__hooks}/oauth.js`).resourceMetadata(require(`${__hooks}/mcp.js`).baseURL($app, e))));
routerAdd("GET", "/.well-known/oauth-protected-resource/mcp", (e) => e.json(200, require(`${__hooks}/oauth.js`).resourceMetadata(require(`${__hooks}/mcp.js`).baseURL($app, e))));

routerAdd("POST", "/oauth/register", (e) => {
  const oauth = require(`${__hooks}/oauth.js`);
  let body = {}; try { body = e.requestInfo().body || {}; } catch (_) {}
  oauth.noStore(e);
  return e.json(201, oauth.registerClient($app, body));
});

routerAdd("GET", "/oauth/authorize", (e) => {
  const oauth = require(`${__hooks}/oauth.js`);
  const appName = String($app.settings().meta.appName || "WeCairn");
  const qp = e.request.url.query();
  const g = (k) => String(qp.get(k) || "");
  e.response.header().set("Content-Type", "text/html; charset=utf-8");
  const page = (ctx) => e.html(200, oauth.authorizePage(Object.assign({ appName }, ctx)));
  try {
    const { client, redirectUri } = oauth.checkClient($app, g("client_id"), g("redirect_uri"));
    if (g("response_type") !== "code") return page({ error: "response_type doit valoir « code »." });
    if (!g("code_challenge") || (g("code_challenge_method") || "S256") !== "S256") return page({ error: "PKCE (S256) est obligatoire." });
    return page({ client: { name: client.get("name") }, params: { client_id: g("client_id"), redirect_uri: redirectUri, state: g("state"), code_challenge: g("code_challenge"), scope: g("scope") || oauth.SCOPE } });
  } catch (err) { return page({ error: err && err.message ? err.message : String(err) }); }
});

routerAdd("POST", "/oauth/approve", (e) => {
  const oauth = require(`${__hooks}/oauth.js`);
  const b = e.requestInfo().body || {};
  const { client, redirectUri } = oauth.checkClient($app, b.client_id, b.redirect_uri);
  if (!b.code_challenge) throw new BadRequestError("code_challenge manquant.");
  const code = oauth.issueCode($app, { user: e.auth.id, client_id: client.get("client_id"), client_name: client.get("name"), redirect_uri: redirectUri, code_challenge: String(b.code_challenge), scope: String(b.scope || oauth.SCOPE) });
  oauth.noStore(e);
  return e.json(200, { redirect: oauth.withQuery(redirectUri, { code, state: b.state ? String(b.state) : "" }) });
}, $apis.requireAuth("users"));

routerAdd("POST", "/oauth/token", (e) => {
  const oauth = require(`${__hooks}/oauth.js`), mcp = require(`${__hooks}/mcp.js`);
  let b = {}; try { b = e.requestInfo().body || {}; } catch (_) {}
  oauth.noStore(e);
  const fail = (code, desc, status) => e.json(status || 400, { error: code, error_description: desc });
  if (String(b.grant_type) !== "authorization_code") return fail("unsupported_grant_type", "Seul authorization_code est pris en charge ; à l'expiration (30 jours), relancez l'autorisation.");
  const d = oauth.consumeCode($app, b.code);
  if (!d) return fail("invalid_grant", "Code inconnu, déjà utilisé ou expiré.");
  if (String(b.client_id || "") !== d.client_id) return fail("invalid_grant", "client_id absent ou différent de celui de l'autorisation.");
  // redirect_uri reste facultatif ici (OAuth 2.1 : le code est déjà lié par PKCE) mais doit correspondre s'il est fourni.
  if (b.redirect_uri && String(b.redirect_uri) !== d.redirect_uri) return fail("invalid_grant", "redirect_uri différent de celui de l'autorisation.");
  if (!oauth.pkceOk(b.code_verifier, d.code_challenge)) return fail("invalid_grant", "Vérification PKCE échouée.");
  let user; try { user = $app.findRecordById("users", d.user); } catch (_) { return fail("invalid_grant", "Utilisateur introuvable."); }
  const key = mcp.createKey($app, user, d.client_name || "Agent (OAuth)");
  return e.json(200, { access_token: key.key, token_type: "Bearer", expires_in: mcp.KEY_DAYS * 86400, scope: d.scope });
});
