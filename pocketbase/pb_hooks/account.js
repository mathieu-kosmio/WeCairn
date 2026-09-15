/**
 * Compte utilisateur WeCairn : détection superadmin et alignement des mots de passe entre un
 * superutilisateur (_superusers) et son jumeau membre (users) de même e-mail. Module CommonJS.
 *
 * SÉCURITÉ : l'alignement va UNIQUEMENT de la console vers l'application, et seulement vers un membre
 * dont l'adresse est vérifiée. Jamais l'inverse : sinon quiconque s'inscrit avec l'e-mail d'un
 * administrateur remplacerait son mot de passe de console (prise de contrôle). Le test « prise de
 * contrôle du superutilisateur impossible » de tests/api.test.mjs protège cette règle.
 */

/** Vrai si le membre connecté a une adresse vérifiée qui est aussi celle d'un superutilisateur. */
function isSuperadmin(app, authRecord) {
  if (!authRecord || !authRecord.get("verified")) return false;
  const email = String(authRecord.get("email") || "").toLowerCase();
  if (!email) return false;
  try { app.findAuthRecordByEmail("_superusers", email); return true; } catch (_) { return false; }
}

/**
 * Après une connexion ou un changement de mot de passe réussi dans la console, aligne le mot de passe
 * du membre jumeau (même e-mail, adresse vérifiée). Silencieux s'il n'existe pas ou n'est pas vérifié.
 */
function syncMemberFromSuperuser(app, email, password) {
  email = String(email || "").trim().toLowerCase();
  password = String(password || "");
  if (!email || !password) return;
  let member;
  try { member = app.findAuthRecordByEmail("users", email); } catch (_) { return; }
  if (!member.get("verified")) return;
  try {
    if (member.validatePassword(password)) return;
    member.setPassword(password);
    app.save(member);
  } catch (err) {
    app.logger().warn("wecairn: alignement du mot de passe membre impossible", "err", String(err));
  }
}

module.exports = { isSuperadmin, syncMemberFromSuperuser };
