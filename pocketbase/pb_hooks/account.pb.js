/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : compte utilisateur.
 *
 * 1. GET /api/wecairn/me -> { superadmin } : vrai si un superutilisateur PocketBase porte le même e-mail
 *    que l'utilisateur connecté (l'interface affiche alors le lien vers la console /_/).
 * 2. Mot de passe unique : quand une personne est à la fois membre (collection users) et superutilisateur
 *    (_superusers) avec le même e-mail, les deux mots de passe sont alignés à chaque connexion réussie
 *    et à chaque changement de mot de passe, dans les deux sens. La console et l'application partagent
 *    ainsi le même mot de passe sans double saisie. Logique dans account.js (require, VM isolées).
 */

routerAdd("GET", "/api/wecairn/me", (e) => {
  const acc = require(`${__hooks}/account.js`);
  return e.json(200, { superadmin: acc.isSuperadmin($app, e.auth) });
}, $apis.requireAuth());

// Connexion réussie : on aligne le jumeau sur le mot de passe qui vient d'être validé
onRecordAuthWithPasswordRequest((e) => {
  e.next();
  require(`${__hooks}/account.js`).syncTwinPassword($app, "users", e.identity, e.password);
}, "users");

onRecordAuthWithPasswordRequest((e) => {
  e.next();
  require(`${__hooks}/account.js`).syncTwinPassword($app, "_superusers", e.identity, e.password);
}, "_superusers");

// Changement de mot de passe (application ou console) : on propage au jumeau
onRecordUpdateRequest((e) => {
  const pwd = String(e.requestInfo().body.password || "");
  e.next();
  if (pwd) require(`${__hooks}/account.js`).syncTwinPassword($app, "users", e.record.get("email"), pwd);
}, "users");

onRecordUpdateRequest((e) => {
  const pwd = String(e.requestInfo().body.password || "");
  e.next();
  if (pwd) require(`${__hooks}/account.js`).syncTwinPassword($app, "_superusers", e.record.get("email"), pwd);
}, "_superusers");

// Inscription d'un membre dont l'e-mail est déjà superutilisateur : même mot de passe dès le départ
onRecordCreateRequest((e) => {
  const pwd = String(e.requestInfo().body.password || "");
  e.next();
  if (pwd) require(`${__hooks}/account.js`).syncTwinPassword($app, "users", e.record.get("email"), pwd);
}, "users");
