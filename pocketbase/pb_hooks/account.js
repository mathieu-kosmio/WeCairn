/**
 * Compte utilisateur WeCairn : détection superadmin et alignement des mots de passe
 * entre la collection users et _superusers (même e-mail). Module CommonJS.
 */

function isSuperadmin(app, authRecord) {
  const email = String((authRecord && authRecord.get("email")) || "").toLowerCase();
  if (!email) return false;
  try { app.findAuthRecordByEmail("_superusers", email); return true; } catch (_) { return false; }
}

/** Aligne le mot de passe du compte jumeau (même e-mail) dans l'autre collection. Silencieux s'il n'existe pas. */
function syncTwinPassword(app, fromCollection, email, password) {
  email = String(email || "").trim().toLowerCase();
  password = String(password || "");
  if (!email || !password) return;
  const twinCollection = fromCollection === "users" ? "_superusers" : "users";
  let twin;
  try { twin = app.findAuthRecordByEmail(twinCollection, email); } catch (_) { return; }
  try {
    if (twin.validatePassword(password)) return;
    twin.setPassword(password);
    app.save(twin);
  } catch (err) {
    app.logger().warn("wecairn: alignement du mot de passe impossible", "collection", twinCollection, "err", String(err));
  }
}

module.exports = { isSuperadmin, syncTwinPassword };
