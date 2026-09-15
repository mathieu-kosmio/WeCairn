/// <reference path="../pb_data/types.d.ts" />
/**
 * WeCairn : connexion réservée aux adresses vérifiées sur les instances déjà installées.
 *
 * L'organisation d'un membre est déduite du domaine de son e-mail : sans vérification, n'importe qui pouvait
 * s'inscrire avec prenom@client.fr et lire les données de ce client. pb_schema.json porte désormais
 * authRule = "verified = true" pour les nouvelles installations ; l'import de schéma ne se rejouant pas,
 * cette migration l'applique aussi aux bases existantes.
 *
 * Les comptes existants non vérifiés ne sont PAS marqués vérifiés : certains ont pu être créés pendant la
 * faille. Ils se reconnectent après avoir confirmé leur adresse (bouton « Renvoyer l'e-mail de confirmation ») ;
 * leurs clés MCP sont refusées d'ici là (userForKey dans pb_hooks/mcp.js).
 *
 * Effet de bord voulu : en changeant authRule, PocketBase renouvelle le secret des jetons de la collection, donc
 * TOUS les membres sont déconnectés une fois. La clé de jeton des non vérifiés est renouvelée en plus, pour ne
 * pas dépendre de ce comportement. Les clés MCP des membres vérifiés continuent de fonctionner.
 */
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authRule = "verified = true";
  app.save(users);

  for (const member of app.findRecordsByFilter("users", "verified = false", "", 0, 0)) {
    member.refreshTokenKey();
    app.save(member);
  }
}, (app) => {
  // Retour arrière volontairement vide : rouvrir la connexion aux adresses non vérifiées rétablirait la faille.
});
