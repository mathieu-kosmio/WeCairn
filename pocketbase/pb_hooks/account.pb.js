/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : compte utilisateur.
 *
 * 1. GET /api/wecairn/me -> { superadmin } : vrai si le membre connecté, adresse vérifiée, porte le même e-mail
 *    qu'un superutilisateur PocketBase (l'interface affiche alors le lien vers la console /_/).
 * 2. Mot de passe unique, dans un seul sens : quand un superutilisateur se connecte à la console ou change
 *    son mot de passe, le membre jumeau (même e-mail, adresse vérifiée) reçoit le même mot de passe.
 *    L'inverse est volontairement impossible (voir account.js) : un compte membre, qui s'obtient par
 *    simple inscription, ne doit jamais pouvoir modifier un accès administrateur de console.
 *
 * Note PocketBase : chaque handler s'exécute dans une VM isolée, d'où le require() à l'intérieur des
 * handlers plutôt que des constantes au niveau du fichier.
 */

routerAdd("GET", "/api/wecairn/me", (e) => {
  const acc = require(`${__hooks}/account.js`);
  return e.json(200, { superadmin: acc.isSuperadmin($app, e.auth) });
}, $apis.requireAuth());

// Connexion réussie à la console : on aligne le membre jumeau vérifié sur le mot de passe qui vient d'être validé
onRecordAuthWithPasswordRequest((e) => {
  e.next();
  require(`${__hooks}/account.js`).syncMemberFromSuperuser($app, e.record.get("email"), e.password);
}, "_superusers");

// Changement de mot de passe d'un superutilisateur (console) : on propage au membre jumeau vérifié
onRecordUpdateRequest((e) => {
  const pwd = String(e.requestInfo().body.password || "");
  e.next();
  if (pwd) require(`${__hooks}/account.js`).syncMemberFromSuperuser($app, e.record.get("email"), pwd);
}, "_superusers");
