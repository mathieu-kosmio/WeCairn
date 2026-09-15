/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : durcissement issu de l'audit de sécurité (voir docs/securite.md et CHANGELOG.md, version 0.2.0).
 *
 * 1. Adresses uniques sans tenir compte de la casse : BOB@acme.fr ne peut plus doubler bob@acme.fr.
 *    Si la base contient déjà des doublons de casse, l'index n'est pas modifié et un avertissement liste les
 *    adresses à fusionner dans la console ; le reste de la migration s'applique.
 * 2. Membres non vérifiés invisibles des autres membres (users) et absents du classement (leaderboard).
 * 3. Avatars protégés : un fichier d'avatar n'est plus lisible sans jeton de fichier.
 * 4. Limitation de débit par adresse IP (connexions, inscriptions, relais IA, MCP, OAuth). Derrière Coolify ou
 *    Traefik, l'adresse réelle est lue dans X-Forwarded-For (dernière valeur, ajoutée par le proxy).
 *
 * pb_schema.json porte déjà 1 à 3 pour les nouvelles installations ; la limitation de débit est un réglage de
 * l'instance, appliqué ici dans tous les cas. Réglages modifiables ensuite dans la console (Settings > Application).
 */
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  const dups = arrayOf(new DynamicModel({ e: "", n: 0 }));
  app.db().newQuery("SELECT LOWER(email) AS e, COUNT(*) AS n FROM users WHERE email != '' GROUP BY LOWER(email) HAVING COUNT(*) > 1").all(dups);
  if (dups.length) {
    app.logger().warn("wecairn: doublons d'adresse à la casse près, index insensible à la casse non appliqué", "emails", dups.map((d) => d.e).join(", "));
  } else {
    users.indexes = users.indexes.map((i) => /^CREATE UNIQUE INDEX idx_users_email /.test(i)
      ? "CREATE UNIQUE INDEX idx_users_email ON users (email COLLATE NOCASE) WHERE email != ''" : i);
  }
  users.listRule = "organisation = @request.auth.organisation && verified = true";
  users.viewRule = "organisation = @request.auth.organisation && verified = true";
  const avatar = users.fields.getByName("avatar");
  if (avatar) avatar.protected = true;
  app.save(users);

  const board = app.findCollectionByNameOrId("leaderboard");
  if (!/WHERE u\.verified = TRUE/.test(board.viewQuery)) {
    board.viewQuery = board.viewQuery.replace(/FROM users u\s*$/, "FROM users u\nWHERE u.verified = TRUE");
    app.save(board);
  }

  const settings = app.settings();
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules = [
    { label: "_superusers:auth", audience: "", duration: 60, maxRequests: 10 },
    { label: "*:auth", audience: "", duration: 60, maxRequests: 30 },
    { label: "users:create", audience: "", duration: 600, maxRequests: 30 },
    { label: "/api/collections/users/request-", audience: "", duration: 600, maxRequests: 10 },
    { label: "/api/wecairn/ai/", audience: "", duration: 60, maxRequests: 20 },
    { label: "/mcp", audience: "", duration: 60, maxRequests: 120 },
    { label: "/oauth/", audience: "", duration: 60, maxRequests: 20 },
    { label: "/api/batch", audience: "", duration: 1, maxRequests: 3 },
    { label: "/api/", audience: "", duration: 10, maxRequests: 300 },
  ];
  if (!settings.trustedProxy.headers || !settings.trustedProxy.headers.length) settings.trustedProxy.headers = ["X-Forwarded-For"];
  app.save(settings);
}, (app) => {
  // Retour arrière volontairement vide : rouvrir ces accès rétablirait les failles corrigées.
});
